import React, { useState, useEffect, useCallback } from "react"
import { Box, Text, Static, useApp, useInput } from "ink"
import { TextInput, Spinner } from "@inkjs/ui"
import type { ConversationEngine, ConversationEvent } from "../runtime/engine.js"
import type { PersonaDefinition } from "../persona/schema.js"

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  text: string
}

interface ChatAppProps {
  engine: ConversationEngine
  persona: PersonaDefinition
}

export function ChatApp({ engine, persona }: ChatAppProps) {
  const { exit } = useApp()
  const mode = persona.container?.enabled ? "container" : "host"

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "header",
      role: "system",
      text: `Chatting with ${persona.name} (via Open Code, ${mode} mode). Press Ctrl+D to exit.`,
    },
  ])
  const [streamingText, setStreamingText] = useState("")
  const [status, setStatus] = useState<"idle" | "thinking" | "responding" | "exiting">("idle")
  const [msgCounter, setMsgCounter] = useState(0)

  const addMessage = useCallback((role: ChatMessage["role"], text: string) => {
    setMsgCounter(prev => {
      const id = `msg-${prev}`
      setMessages(msgs => [...msgs, { id, role, text }])
      return prev + 1
    })
  }, [])

  useEffect(() => {
    const onThinking = () => setStatus("thinking")
    const onResponding = () => setStatus("responding")
    const onChunk = (text: string) => {
      setStreamingText(prev => prev + text)
    }
    const onResponse = ({ text }: ConversationEvent) => {
      addMessage("assistant", text)
      setStreamingText("")
      setStatus("idle")
    }
    const onMessage = (event: ConversationEvent) => {
      if (event.source.type === "telegram" && event.role === "user") {
        addMessage("system", `[phone] ${event.text}`)
      }
    }

    engine.on("thinking", onThinking)
    engine.on("responding", onResponding)
    engine.on("chunk", onChunk)
    engine.on("response", onResponse)
    engine.on("message", onMessage)

    return () => {
      engine.off("thinking", onThinking)
      engine.off("responding", onResponding)
      engine.off("chunk", onChunk)
      engine.off("response", onResponse)
      engine.off("message", onMessage)
    }
  }, [engine, addMessage])

  useInput((_input, key) => {
    if (key.ctrl && (_input === "d" || _input === "c")) {
      if (status === "exiting") return
      setStatus("exiting")
      engine.shutdown().then(() => exit()).catch(() => exit())
    }
  })

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || status !== "idle") return

    addMessage("user", value)

    try {
      await engine.handleMessage(value, { type: "cli" })
    } catch (err) {
      addMessage("system", `Error: ${(err as Error).message}`)
      setStatus("idle")
    }
  }, [engine, addMessage, status])

  return (
    <Box flexDirection="column">
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column">
            {msg.role === "user" ? (
              <Box>
                <Text bold color="green">{"you: "}</Text>
                <Text>{msg.text}</Text>
              </Box>
            ) : msg.role === "system" ? (
              <Text dimColor>{msg.text}</Text>
            ) : (
              <Box flexDirection="column">
                <Text bold color="cyan">{persona.name + ": "}</Text>
                <Text>{msg.text}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {status === "thinking" && (
        <Box>
          <Spinner label="Thinking" />
        </Box>
      )}

      {status === "responding" && streamingText && (
        <Box flexDirection="column">
          <Text bold color="cyan">{persona.name + ": "}</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {status === "exiting" && (
        <Box>
          <Spinner label="Saving memories" />
        </Box>
      )}

      {status === "idle" && (
        <Box>
          <Text bold color="green">{"you: "}</Text>
          <TextInput onSubmit={handleSubmit} />
        </Box>
      )}
    </Box>
  )
}
