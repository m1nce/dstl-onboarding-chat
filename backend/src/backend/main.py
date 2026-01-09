from contextlib import asynccontextmanager
from typing import List
import os
from pathlib import Path
from dotenv import load_dotenv

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, SQLModel, select

from .database import create_db_and_tables, get_session, seed_db
from .models import Conversation, Message
from .llm import generate_llm_response

load_dotenv()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
print("ENVIRONMENT in FastAPI:", ENVIRONMENT)

def get_conversation_messages(session: Session, conversation_id: int) -> list[Message]:
    """
    Return all messages for a conversation in chronological order.
    """
    return session.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    ).all()

class ConversationBase(SQLModel):
    title: str | None = None

class ConversationCreate(ConversationBase):
    pass

class ConversationRead(ConversationBase):
    id: int

class MessageBase(SQLModel):
    role: str
    content: str

class MessageCreate(MessageBase):
    pass

class MessageRead(MessageBase):
    id: int
    conversation_id: int

class ConversationReadWithMessages(ConversationRead):
    messages: list[MessageRead] = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    seed_db()
    yield


app = FastAPI(lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In production, also serve the built frontend from /app
if ENVIRONMENT == "production":
    static_dir = Path(__file__).parent / "static"
    app.mount(
        "/app",
        StaticFiles(directory=static_dir, html=True),
        name="static",
    )


@app.post("/conversations/", response_model=ConversationRead)
def create_conversation(
    conversation: ConversationCreate, session: Session = Depends(get_session)
):
    # Create a DB Conversation row from input (title is optional)
    db_conversation = Conversation(title=conversation.title)
    session.add(db_conversation)
    session.commit()
    session.refresh(db_conversation)

    # If no title provided, set a default like "Conversation {id}"
    if db_conversation.title is None:
        db_conversation.title = f"Conversation {db_conversation.id}"
        session.add(db_conversation)
        session.commit()
        session.refresh(db_conversation)

    return ConversationRead.from_orm(db_conversation)


@app.get("/conversations/", response_model=List[ConversationRead])
def read_conversations(
    offset: int = 0, limit: int = 100, session: Session = Depends(get_session)
):
    conversations = session.exec(
        select(Conversation).offset(offset).limit(limit)
    ).all()
    return [ConversationRead.from_orm(c) for c in conversations]


@app.get("/conversations/{conversation_id}", response_model=ConversationReadWithMessages)
def read_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = get_conversation_messages(session, conversation_id)

    return ConversationReadWithMessages(
        id=conversation.id,
        title=conversation.title,
        messages=[MessageRead.from_orm(m) for m in messages],
    )


@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete all messages for this conversation first
    messages = get_conversation_messages(session, conversation_id)
    for m in messages:
        session.delete(m)

    session.delete(conversation)
    session.commit()
    return {"ok": True}

@app.get(
    "/conversations/{conversation_id}/messages",
    response_model=List[MessageRead],
)
def read_messages_for_conversation(
    conversation_id: int,
    session: Session = Depends(get_session),
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = get_conversation_messages(session, conversation_id)
    return [MessageRead.from_orm(m) for m in messages]

@app.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageRead,
)
def create_message_for_conversation(
    conversation_id: int,
    message_in: MessageCreate,
    session: Session = Depends(get_session),
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    message = Message(
        conversation_id=conversation_id,
        role=message_in.role,
        content=message_in.content,
    )
    session.add(message)
    session.commit()
    session.refresh(message)
    return MessageRead.from_orm(message)

@app.post(
    "/conversations/{conversation_id}/llm_reply",
    response_model=MessageRead,
)
def generate_llm_reply(
    conversation_id: int,
    session: Session = Depends(get_session),
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 1. Load history
    history = get_conversation_messages(session, conversation_id)

    if not history:
        raise HTTPException(
            status_code=400,
            detail="No messages in conversation to build a prompt from.",
        )

    # 2. Build LLM-style messages and call NRP LLM
    llm_messages: list[dict[str, object]] = [
        {
            "role": "system",
            "content": "You are a helpful assistant for the DSTL Chat App.",
        }
    ]
    for m in history:
        llm_messages.append(
            {
                "role": m.role,
                "content": m.content,
            }
        )

    try:
        assistant_text = generate_llm_response(llm_messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail="LLM call failed") from e

    # 3. Save assistant message to DB
    assistant_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_text,
    )
    session.add(assistant_message)
    session.commit()
    session.refresh(assistant_message)

    # 4. Return it to frontend
    return MessageRead.from_orm(assistant_message)