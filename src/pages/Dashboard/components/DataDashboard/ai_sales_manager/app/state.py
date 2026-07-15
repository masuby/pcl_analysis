"""Graph state + the structured Prospect model."""
import operator
from typing import Annotated, TypedDict
from pydantic import BaseModel, Field


class Prospect(BaseModel):
    """One discovered LBF/SME loan prospect (a car owner/seller/dealer for LBF)."""
    name: str = Field(default="", description="Person or business name")
    product: str = Field(default="LBF", description="LBF or SME")
    car_make: str = Field(default="", description="Vehicle make, if applicable")
    car_model: str = Field(default="", description="Vehicle model")
    car_year: str = Field(default="", description="Vehicle year")
    est_value_tzs: str = Field(default="", description="Estimated vehicle/asset value in TZS")
    business_type: str = Field(default="", description="Business type, for SME prospects")
    location: str = Field(default="", description="City / region in Tanzania")
    contact: str = Field(default="", description="Public phone/email if the listing shows one")
    source_url: str = Field(default="", description="Where this prospect was found")
    score: str = Field(default="Cold", description="Hot | Warm | Cold — fit for the product")
    est_loan_tzs: str = Field(default="", description="Rough loan potential (~50-70% of asset value)")
    reason: str = Field(default="", description="One line: why this score")


class ProspectBatch(BaseModel):
    prospects: list[Prospect] = Field(default_factory=list)


class AgentState(TypedDict, total=False):
    # inputs
    product: str          # 'LBF' (Phase 1) or 'SME'
    region: str           # e.g. 'Dar es Salaam' or '' for nationwide
    max_leads: int
    model: str            # LLM id, e.g. 'groq: llama-3.3-70b' ('' = default)
    # working data
    queries: list         # planned search queries
    raw_results: list     # tavily results [{title,url,content}]
    prospects: list       # scored Prospect dicts
    # outputs
    delivered: int
    sheet_url: str
    log: Annotated[list, operator.add]   # human-readable step log
