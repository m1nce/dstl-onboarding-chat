import os
from typing import Any, List

from dotenv import load_dotenv  # type: ignore
from openai import OpenAI

# Load environment variables from .env file
load_dotenv()

# Initialize OpenAI client for NRP
client = OpenAI(
    api_key=os.environ.get("NRP_API_KEY"),
    base_url="https://ellm.nrp-nautilus.io/v1",
)


def generate_llm_response(
    messages: List[dict[str, Any]], model: str = "gemma3"
) -> str:
    """
    Generate a response from the LLM given a list of messages.
    Args:
        messages: List of message dictionaries with 'role' and 'content' keys
        model: The model to use for generation (default: "gemma3")
    Returns:
        The generated response content as a string
    Raises:
        Exception: If there's an error calling the LLM API
    """
    completion = client.chat.completions.create(
        model=model,
        messages=messages,  # type: ignore
    )

    response_content = completion.choices[0].message.content
    if response_content is None:
        raise ValueError("LLM returned empty response")

    return response_content