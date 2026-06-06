package whatsapp

import (
	"context"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// WATypingNotifier implements DebounceHandler's TypingNotifier by sending
// Composing/Paused chat presence updates via the whatsmeow client.
type WATypingNotifier struct {
	Client *whatsmeow.Client
}

// SendTyping translates the boolean composing flag into a WhatsApp chat
// presence update. Errors are silently swallowed — presence is best-effort.
func (w *WATypingNotifier) SendTyping(phone string, composing bool) {
	jid, err := types.ParseJID(phone)
	if err != nil {
		return
	}
	presence := types.ChatPresencePaused
	if composing {
		presence = types.ChatPresenceComposing
	}
	_ = w.Client.SendChatPresence(context.Background(), jid, presence, types.ChatPresenceMediaText)
}
