"""Semantic routing for query-based model selection.

Classifies queries by intent and routes to optimal models/providers.
"""

from enum import Enum
from typing import Any, Optional

import httpx

from app.config import get_settings


class QueryType(Enum):
    """Types of queries for semantic routing."""
    CODE = "code"  # Programming tasks
    CREATIVE = "creative"  # Creative writing
    ANALYTICAL = "analytical"  # Analysis and reasoning
    FACTUAL = "factual"  # Fact lookup
    CONVERSATIONAL = "conversational"  # Chat/social
    COMPLEX = "complex"  # Multi-step reasoning


class SemanticRouter:
    """Routes requests based on query semantic classification.
    
    Uses LLM to classify queries and route to optimal models:
    - Code queries -> GPT-4, Claude, or Codex models
    - Creative queries -> Claude, GPT-4 with temperature
    - Factual queries -> Cheaper models with caching
    - Complex queries -> Most capable models
    """
    
    def __init__(self) -> None:
        """Initialize semantic router."""
        settings = get_settings()
        self.classifier_model = getattr(settings, "CLASSIFIER_MODEL", "gpt-4o-mini")
        self.openai_api_key = getattr(settings, "OPENAI_API_KEY", None)
    
    async def classify_query(self, query: str) -> tuple[QueryType, float]:
        """Classify a query by semantic type.
        
        Args:
            query: User query/prompt.
            
        Returns:
            Tuple of (query_type, confidence).
        """
        # Use LLM for classification
        if not self.openai_api_key:
            # Fallback to rule-based
            return self._classify_rule_based(query)
        
        try:
            return await self._classify_with_llm(query)
        except Exception:
            # Fallback on error
            return self._classify_rule_based(query)
    
    def _classify_rule_based(self, query: str) -> tuple[QueryType, float]:
        """Rule-based classification as fallback.
        
        Args:
            query: User query.
            
        Returns:
            Classification result.
        """
        query_lower = query.lower()
        
        # Code patterns
        code_patterns = [
            "code", "function", "class", "def ", "import ", "error:",
            "debug", "programming", "python", "javascript", "typescript",
            "bug", "exception", "traceback", "compile", "syntax",
        ]
        if any(p in query_lower for p in code_patterns):
            return QueryType.CODE, 0.7
        
        # Creative patterns
        creative_patterns = [
            "write", "story", "poem", "creative", "imagine", "fiction",
            "character", "plot", "dialogue", "scene", "novel",
        ]
        if any(p in query_lower for p in creative_patterns):
            return QueryType.CREATIVE, 0.7
        
        # Analytical patterns
        analytical_patterns = [
            "analyze", "compare", "evaluate", "assess", "review",
            "pros and cons", "advantages", "disadvantages", "trade-offs",
        ]
        if any(p in query_lower for p in analytical_patterns):
            return QueryType.ANALYTICAL, 0.7
        
        # Complex patterns
        complex_patterns = [
            "explain step by step", "how to", "guide", "tutorial",
            "multiple steps", "process", "workflow",
        ]
        if any(p in query_lower for p in complex_patterns):
            return QueryType.COMPLEX, 0.6
        
        # Default to factual
        return QueryType.FACTUAL, 0.5
    
    async def _classify_with_llm(self, query: str) -> tuple[QueryType, float]:
        """Use LLM to classify query.
        
        Args:
            query: User query.
            
        Returns:
            Classification result.
        """
        prompt = f"""Classify the following query into one of these categories:
- code: Programming, debugging, technical implementation
- creative: Writing, storytelling, creative content
- analytical: Analysis, comparison, evaluation
- factual: Fact lookup, definitions, simple questions
- conversational: Chat, social interaction
- complex: Multi-step reasoning, deep problem solving

Query: {query[:500]}

Respond with ONLY the category name (one word), nothing else:"""

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.classifier_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 10,
                },
                timeout=10.0,
            )
            
            response.raise_for_status()
            data = response.json()
            
            result = data["choices"][0]["message"]["content"].strip().lower()
            
            # Map to enum
            try:
                return QueryType(result), 0.85
            except ValueError:
                return QueryType.FACTUAL, 0.5
    
    def get_routing_config(
        self,
        query_type: QueryType,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Get routing configuration for a query type.
        
        Args:
            query_type: Classified query type.
            config: Gateway configuration.
            
        Returns:
            Routing configuration.
        """
        providers = config.get("providers", {})
        
        # Routing strategies by query type
        strategies = {
            QueryType.CODE: {
                "preferred_models": ["gpt-4", "claude-3-opus", "claude-3-sonnet"],
                "fallback_chain": ["gpt-4", "claude-3-sonnet", "gpt-3.5-turbo"],
                "temperature": 0.1,
                "max_tokens": 4000,
                "use_caching": True,
            },
            QueryType.CREATIVE: {
                "preferred_models": ["claude-3-opus", "gpt-4", "claude-3-sonnet"],
                "fallback_chain": ["claude-3-sonnet", "gpt-4", "gpt-3.5-turbo"],
                "temperature": 0.9,
                "max_tokens": 2000,
                "use_caching": False,
            },
            QueryType.ANALYTICAL: {
                "preferred_models": ["gpt-4", "claude-3-opus", "claude-3-sonnet"],
                "fallback_chain": ["gpt-4", "claude-3-sonnet", "gpt-3.5-turbo"],
                "temperature": 0.3,
                "max_tokens": 3000,
                "use_caching": True,
            },
            QueryType.FACTUAL: {
                "preferred_models": ["gpt-3.5-turbo", "claude-3-haiku"],
                "fallback_chain": ["gpt-3.5-turbo", "claude-3-haiku"],
                "temperature": 0.1,
                "max_tokens": 1000,
                "use_caching": True,
            },
            QueryType.CONVERSATIONAL: {
                "preferred_models": ["gpt-3.5-turbo", "claude-3-haiku"],
                "fallback_chain": ["gpt-3.5-turbo"],
                "temperature": 0.7,
                "max_tokens": 500,
                "use_caching": False,
            },
            QueryType.COMPLEX: {
                "preferred_models": ["gpt-4", "claude-3-opus"],
                "fallback_chain": ["gpt-4", "claude-3-opus", "claude-3-sonnet"],
                "temperature": 0.2,
                "max_tokens": 4000,
                "use_caching": False,
            },
        }
        
        return strategies.get(query_type, strategies[QueryType.FACTUAL])


class CostOptimizer:
    """Optimizes routing for cost while maintaining quality.
    
    Routes simpler queries to cheaper models, complex queries to
    more capable (expensive) models.
    """
    
    # Model costs per 1K tokens (input, output)
    MODEL_COSTS = {
        "gpt-4": (0.03, 0.06),
        "gpt-4-turbo": (0.01, 0.03),
        "gpt-3.5-turbo": (0.0005, 0.0015),
        "claude-3-opus": (0.015, 0.075),
        "claude-3-sonnet": (0.003, 0.015),
        "claude-3-haiku": (0.00025, 0.00125),
    }
    
    def estimate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
    ) -> float:
        """Estimate cost for a request.
        
        Args:
            model: Model name.
            input_tokens: Input token count.
            output_tokens: Expected output token count.
            
        Returns:
            Estimated cost in USD.
        """
        costs = self.MODEL_COSTS.get(model, (0.01, 0.03))
        
        input_cost = (input_tokens / 1000) * costs[0]
        output_cost = (output_tokens / 1000) * costs[1]
        
        return input_cost + output_cost
    
    def find_cheaper_alternative(
        self,
        target_model: str,
        query_complexity: float,
        min_quality: float = 0.8,
    ) -> Optional[str]:
        """Find a cheaper model that can handle the query.
        
        Args:
            target_model: Preferred expensive model.
            query_complexity: Complexity score 0-1.
            min_quality: Minimum quality threshold.
            
        Returns:
            Cheaper model name or None.
        """
        target_cost = self.MODEL_COSTS.get(target_model, (0.01, 0.03))
        
        # Define quality tiers (simplified)
        quality_tiers = {
            "gpt-4": 1.0,
            "gpt-4-turbo": 0.95,
            "claude-3-opus": 0.98,
            "claude-3-sonnet": 0.90,
            "gpt-3.5-turbo": 0.75,
            "claude-3-haiku": 0.70,
        }
        
        target_quality = quality_tiers.get(target_model, 0.8)
        required_quality = target_quality * min_quality
        
        best_alternative = None
        best_cost = float('inf')
        
        for model, costs in self.MODEL_COSTS.items():
            if model == target_model:
                continue
            
            model_quality = quality_tiers.get(model, 0.5)
            
            # Check if quality is sufficient
            if model_quality < required_quality:
                continue
            
            # Check if significantly cheaper
            model_cost = sum(costs)
            if model_cost < best_cost and model_cost < sum(target_cost) * 0.7:
                best_cost = model_cost
                best_alternative = model
        
        return best_alternative
