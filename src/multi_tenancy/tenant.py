"""Multi-tenancy support for LLM Gateway.

Isolates tenants by organization with separate:
- Rate limits
- Budgets
- Provider configs
- Audit logs
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Tenant:
    """Tenant/Organization data.
    
    Represents an isolated organization using the gateway.
    """
    
    id: str
    name: str
    plan: str = "free"  # free, basic, pro, enterprise
    status: str = "active"  # active, suspended, cancelled
    
    # Limits
    monthly_budget_usd: float = 100.0
    rate_limit_rpm: int = 60
    max_api_keys: int = 5
    
    # Features
    features: dict[str, bool] = field(default_factory=dict)
    
    # Provider overrides
    provider_configs: dict[str, Any] = field(default_factory=dict)
    
    # Metadata
    metadata: dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self) -> None:
        """Set default features."""
        default_features = {
            "caching": True,
            "rate_limiting": True,
            "budget_tracking": True,
            "fallback": True,
            "semantic_routing": self.plan in ["pro", "enterprise"],
            "advanced_analytics": self.plan == "enterprise",
        }
        default_features.update(self.features)
        self.features = default_features
    
    def is_feature_enabled(self, feature: str) -> bool:
        """Check if feature is enabled for tenant.
        
        Args:
            feature: Feature name.
            
        Returns:
            True if enabled.
        """
        return self.features.get(feature, False)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "plan": self.plan,
            "status": self.status,
            "limits": {
                "monthly_budget_usd": self.monthly_budget_usd,
                "rate_limit_rpm": self.rate_limit_rpm,
                "max_api_keys": self.max_api_keys,
            },
            "features": self.features,
        }


class TenantManager:
    """Manages tenant lifecycle and isolation.
    
    Provides tenant CRUD and lookup operations.
    """
    
    def __init__(self) -> None:
        """Initialize tenant manager."""
        self._tenants: dict[str, Tenant] = {}
        self._api_key_to_tenant: dict[str, str] = {}  # api_key -> tenant_id
    
    def create_tenant(
        self,
        name: str,
        plan: str = "free",
        **kwargs: Any,
    ) -> Tenant:
        """Create a new tenant.
        
        Args:
            name: Tenant name.
            plan: Subscription plan.
            **kwargs: Additional tenant config.
            
        Returns:
            Created tenant.
        """
        import uuid
        
        tenant_id = f"tenant_{uuid.uuid4().hex[:12]}"
        
        tenant = Tenant(
            id=tenant_id,
            name=name,
            plan=plan,
            **kwargs,
        )
        
        self._tenants[tenant_id] = tenant
        return tenant
    
    def get_tenant(self, tenant_id: str) -> Tenant | None:
        """Get tenant by ID.
        
        Args:
            tenant_id: Tenant ID.
            
        Returns:
            Tenant or None.
        """
        return self._tenants.get(tenant_id)
    
    def get_tenant_by_api_key(self, api_key: str) -> Tenant | None:
        """Get tenant for API key.
        
        Args:
            api_key: API key.
            
        Returns:
            Tenant or None.
        """
        tenant_id = self._api_key_to_tenant.get(api_key)
        if tenant_id:
            return self._tenants.get(tenant_id)
        return None
    
    def assign_api_key(self, tenant_id: str, api_key: str) -> None:
        """Assign API key to tenant.
        
        Args:
            tenant_id: Tenant ID.
            api_key: API key.
        """
        self._api_key_to_tenant[api_key] = tenant_id
    
    def list_tenants(self) -> list[Tenant]:
        """List all tenants.
        
        Returns:
            List of tenants.
        """
        return list(self._tenants.values())
    
    def update_tenant(
        self,
        tenant_id: str,
        **kwargs: Any,
    ) -> Tenant | None:
        """Update tenant.
        
        Args:
            tenant_id: Tenant ID.
            **kwargs: Fields to update.
            
        Returns:
            Updated tenant or None.
        """
        tenant = self._tenants.get(tenant_id)
        if not tenant:
            return None
        
        for key, value in kwargs.items():
            if hasattr(tenant, key):
                setattr(tenant, key, value)
        
        return tenant


class TenantAwareBudgetTracker:
    """Budget tracking per tenant.
    
    Tracks and enforces budget limits per organization.
    """
    
    def __init__(self, tenant_manager: TenantManager) -> None:
        """Initialize tracker.
        
        Args:
            tenant_manager: Tenant manager instance.
        """
        self.tenant_manager = tenant_manager
        self._usage: dict[str, float] = {}  # tenant_id -> current month usage
    
    def record_usage(self, tenant_id: str, cost_usd: float) -> dict[str, Any]:
        """Record usage for tenant.
        
        Args:
            tenant_id: Tenant ID.
            cost_usd: Cost of request.
            
        Returns:
            Usage status.
        """
        tenant = self.tenant_manager.get_tenant(tenant_id)
        if not tenant:
            return {"error": "Tenant not found"}
        
        # Update usage
        current = self._usage.get(tenant_id, 0.0)
        new_usage = current + cost_usd
        self._usage[tenant_id] = new_usage
        
        # Check limits
        budget = tenant.monthly_budget_usd
        remaining = budget - new_usage
        percent_used = (new_usage / budget) * 100 if budget > 0 else 0
        
        return {
            "tenant_id": tenant_id,
            "current_usage_usd": round(new_usage, 4),
            "monthly_budget_usd": budget,
            "remaining_usd": round(remaining, 4),
            "percent_used": round(percent_used, 2),
            "over_budget": new_usage > budget,
            "warning": percent_used > 80,
        }
    
    def check_budget(self, tenant_id: str) -> dict[str, Any]:
        """Check budget status for tenant.
        
        Args:
            tenant_id: Tenant ID.
            
        Returns:
            Budget status.
        """
        return self.record_usage(tenant_id, 0.0)  # Just check, don't add
    
    def can_make_request(
        self,
        tenant_id: str,
        estimated_cost: float = 0.01,
    ) -> bool:
        """Check if tenant can make a request.
        
        Args:
            tenant_id: Tenant ID.
            estimated_cost: Estimated cost of request.
            
        Returns:
            True if allowed.
        """
        status = self.record_usage(tenant_id, estimated_cost)
        return not status.get("over_budget", False)
