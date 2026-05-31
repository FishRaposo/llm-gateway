"""Circuit breaker pattern for provider resilience.

Prevents cascade failures by stopping requests to failing providers
and allowing them to recover.
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Callable, TypeVar

from dataclasses import dataclass


T = TypeVar("T")


class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker."""
    failure_threshold: int = 5
    recovery_timeout: float = 30.0
    half_open_max_calls: int = 3
    success_threshold: int = 2


class CircuitBreaker:
    """Circuit breaker for provider resilience.
    
    Tracks failures and opens circuit when threshold exceeded.
    Attempts recovery after timeout.
    """
    
    def __init__(
        self,
        name: str,
        config: CircuitBreakerConfig | None = None,
    ) -> None:
        """Initialize circuit breaker.
        
        Args:
            name: Circuit breaker name (typically provider name).
            config: Circuit breaker configuration.
        """
        self.name = name
        self.config = config or CircuitBreakerConfig()
        
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time: float | None = None
        self.half_open_calls = 0
    
    def can_execute(self) -> bool:
        """Check if request can be executed.
        
        Returns:
            True if circuit allows execution.
        """
        if self.state == CircuitState.CLOSED:
            return True
        
        if self.state == CircuitState.OPEN:
            # Check if recovery timeout has passed
            if self.last_failure_time:
                elapsed = time.time() - self.last_failure_time
                if elapsed >= self.config.recovery_timeout:
                    self.state = CircuitState.HALF_OPEN
                    self.half_open_calls = 0
                    return True
            return False
        
        if self.state == CircuitState.HALF_OPEN:
            # Allow limited calls in half-open state
            if self.half_open_calls < self.config.half_open_max_calls:
                self.half_open_calls += 1
                return True
            return False
        
        return True
    
    def record_success(self) -> None:
        """Record a successful call."""
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.config.success_threshold:
                # Close the circuit
                self._reset()
        elif self.state == CircuitState.CLOSED:
            # Reset failure count on success
            self.failure_count = 0
    
    def record_failure(self) -> None:
        """Record a failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.state == CircuitState.CLOSED:
            if self.failure_count >= self.config.failure_threshold:
                # Open the circuit
                self.state = CircuitState.OPEN
        elif self.state == CircuitState.HALF_OPEN:
            # Go back to open
            self.state = CircuitState.OPEN
            self.half_open_calls = 0
    
    def _reset(self) -> None:
        """Reset circuit to closed state."""
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
        self.half_open_calls = 0
    
    async def call(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Execute function with circuit breaker protection.
        
        Args:
            func: Function to call.
            *args: Function arguments.
            **kwargs: Function keyword arguments.
            
        Returns:
            Function result.
            
        Raises:
            CircuitBreakerOpen: If circuit is open.
            Exception: If function raises.
        """
        if not self.can_execute():
            raise CircuitBreakerOpen(f"Circuit breaker '{self.name}' is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise
    
    def get_state(self) -> dict[str, Any]:
        """Get current state information.
        
        Returns:
            State dict.
        """
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_failure_time": self.last_failure_time,
            "config": {
                "failure_threshold": self.config.failure_threshold,
                "recovery_timeout": self.config.recovery_timeout,
            },
        }


class CircuitBreakerOpen(Exception):
    """Exception raised when circuit breaker is open."""
    pass


class CircuitBreakerRegistry:
    """Registry for circuit breakers by provider."""
    
    def __init__(self) -> None:
        """Initialize registry."""
        self._breakers: dict[str, CircuitBreaker] = {}
    
    def get(self, name: str) -> CircuitBreaker:
        """Get or create circuit breaker.
        
        Args:
            name: Circuit breaker name.
            
        Returns:
            Circuit breaker instance.
        """
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(name)
        return self._breakers[name]
    
    def get_all_states(self) -> dict[str, dict[str, Any]]:
        """Get states of all circuit breakers.
        
        Returns:
            Dict of breaker states.
        """
        return {
            name: breaker.get_state()
            for name, breaker in self._breakers.items()
        }
