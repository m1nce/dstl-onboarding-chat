import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8100';

type Message = {
  id?: number;
  conversation_id?: number | null;
  role: 'user' | 'assistant';
  content: string;
};

type Conversation = {
  id: number;
  title: string | null;
};

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Load list of conversations for the sidebar
  useEffect(() => {
    const fetchConversations = async () => {
      setIsLoadingConversations(true);
      try {
        const response = await fetch(`${API_BASE}/conversations/`);
        if (!response.ok) {
          throw new Error('Failed to load conversations');
        }
        const data = (await response.json()) as Conversation[];
        setConversations(data);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoadingConversations(false);
      }
    };

    fetchConversations();
  }, []);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (selectedConversationId === null) {
      setMessages([]);
      return;
    }

    const fetchConversationMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const response = await fetch(
          `${API_BASE}/conversations/${selectedConversationId}`
        );
        if (!response.ok) {
          throw new Error('Failed to load messages');
        }
        const data = (await response.json()) as Conversation & {
          messages?: Message[];
        };
        setMessages(data.messages ?? []);
      } catch (error) {
        console.error(error);
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    fetchConversationMessages();
  }, [selectedConversationId]);

  // Send a message: create conversation if needed, save user msg, then ask backend/LLM for reply
  const handleSend = async () => {
    if (!input.trim()) return;

    const text = input;
    setInput('');

    try {
      let conversationId = selectedConversationId;

      // 1) If no conversation yet, create one
      if (conversationId === null) {
        const convRes = await fetch(`${API_BASE}/conversations/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Let the backend set / default the title
          body: JSON.stringify({}),
        });

        if (!convRes.ok) {
          throw new Error('Failed to create conversation');
        }

        const newConv = (await convRes.json()) as Conversation;
        conversationId = newConv.id;

        // Ensure a reasonable title in the UI
        const convForUI: Conversation = {
          ...newConv,
          title: newConv.title ?? `Conversation ${newConv.id}`,
        };

        // Update state so sidebar and effects know about this convo
        setSelectedConversationId(convForUI.id);
        setConversations((prev) => [convForUI, ...prev]);
      }

      // 2) Save user message to backend
      const userRes = await fetch(
        `${API_BASE}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: text,
          }),
        }
      );

      if (!userRes.ok) {
        throw new Error('Failed to send message');
      }

      const savedUserMessage = (await userRes.json()) as Message;
      setMessages((prev) => [...prev, savedUserMessage]);

      // 3) Ask backend to call LLM and save assistant reply
      const llmRes = await fetch(
        `${API_BASE}/conversations/${conversationId}/llm_reply`,
        {
          method: 'POST',
        }
      );

      if (!llmRes.ok) {
        console.error('Failed to get LLM reply');
        return;
      }

      const assistantMessage = (await llmRes.json()) as Message;
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className='flex h-screen bg-gray-100'>
      {/* Sidebar */}
      <div className='w-64 bg-gray-900 text-white p-4 flex flex-col'>
        <div className='mb-4'>
          <h1 className='text-xl font-bold'>DSTL Chat App</h1>
        </div>
        <button
          className='w-full py-2 px-4 border border-gray-600 rounded hover:bg-gray-800 text-left mb-4'
          onClick={() => {
            setSelectedConversationId(null);
            setMessages([]);
          }}
        >
          + New Chat
        </button>
        <div className='flex-1 overflow-y-auto space-y-2'>
          {isLoadingConversations && (
            <div className='text-sm text-gray-400'>Loading conversations...</div>
          )}

          {!isLoadingConversations && conversations.length === 0 && (
            <div className='text-sm text-gray-400'>No previous chats yet.</div>
          )}

          {!isLoadingConversations &&
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversationId(conv.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
                  conv.id === selectedConversationId
                    ? 'bg-gray-700 text-white'
                    : 'hover:bg-gray-800 text-gray-200'
                }`}
              >
                {conv.title || `Conversation ${conv.id}`}
              </button>
            ))}
        </div>
      </div>

      {/* Main Content */}
      <div className='flex-1 flex flex-col'>
        {/* Messages Area */}
        <div className='flex-1 overflow-y-auto p-4 space-y-4'>
          {isLoadingMessages && (
            <div className='text-sm text-gray-400'>Loading messages...</div>
          )}

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              <ReactMarkdown>
                {String(msg.content ?? '')}
              </ReactMarkdown>
            </div>
            </div>
          ))}
          {messages.length === 0 && !isLoadingMessages && (
            <div className='text-center text-gray-500 mt-20'>
              <h2 className='text-2xl font-semibold'>
                Welcome to the DSTL Chat App
              </h2>
              <p>Start a conversation!</p>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className='p-4 border-t border-gray-200 bg-white'>
          <div className='flex gap-4 max-w-4xl mx-auto'>
            <textarea
              className='flex-1 border border-gray-300 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500'
              rows={1}
              placeholder='Type a message...'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className='bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50'
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          </div>
          <div className='text-center text-xs text-gray-400 mt-2'>
            Press Enter to send
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
