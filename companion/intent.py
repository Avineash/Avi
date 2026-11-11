"""Turn a spoken transcript into a structured navigation request using Claude."""
from typing import Literal, Optional

import anthropic
from pydantic import BaseModel, Field

from .config import Config


class Destination(BaseModel):
    understood: bool = Field(description="True if the user asked to navigate somewhere.")
    query: Optional[str] = Field(
        default=None,
        description="Search string or address to pass to a maps app, e.g. 'Bunnings Marrickville'.",
    )
    mode: Literal["driving", "walking", "transit"] = "driving"


SYSTEM = (
    "You are a car voice companion. The driver may speak English, Tamil or a mix. "
    "Write query in the form most likely to be found on Google Maps (usually the English spelling of well-known places). "
    "The driver speaks a destination after starting the car. "
    "Extract where they want to go. Resolve 'home' and 'work' using the saved addresses "
    "when given. Speech-to-text may have errors; fix obvious ones. If the request is not a "
    "navigation request or is too vague to search, set understood=false."
)


def parse_destination(transcript: str, cfg: Config, client: anthropic.Anthropic | None = None) -> Destination:
    client = client or anthropic.Anthropic()
    saved = f"Saved addresses: home={cfg.home_address or 'unknown'}; work={cfg.work_address or 'unknown'}."
    response = client.messages.parse(
        model=cfg.model,
        max_tokens=1024,
        system=f"{SYSTEM}\n{saved}",
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": transcript}],
        output_format=Destination,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        return Destination(understood=False)
    return response.parsed_output
