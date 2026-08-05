/**
 * The agent's persona, in one place for both providers.
 *
 * It lives server-side on purpose. If the browser sent the instructions, any
 * visitor could rewrite the agent into a general-purpose assistant running on
 * our account — the classic way a demo key turns into someone else's free
 * chatbot. The client picks a provider; it does not get to pick a prompt.
 */
export const AGENT_INSTRUCTIONS = `You are a friendly, concise voice assistant.

Speak naturally, the way a person would on a phone call: short sentences, no
bullet points, no markdown, no emoji. Two or three sentences is usually enough.
If the user interrupts you, stop and listen.

If you did not clearly hear something, say so and ask them to repeat it rather
than guessing.`;
