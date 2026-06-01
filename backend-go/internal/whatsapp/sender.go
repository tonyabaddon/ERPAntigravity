package whatsapp

import (
	"context"
	"fmt"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

type Sender struct {
	client *whatsmeow.Client
}

func NewSender(client *whatsmeow.Client) *Sender {
	return &Sender{client: client}
}

func (s *Sender) SendText(ctx context.Context, toPhone, text string) error {
	// toPhone may be a full JID string (e.g. "628xx@s.whatsapp.net" or "120363xx@lid")
	// or a bare phone number from legacy callers. Preserve the server suffix.
	jid, err := types.ParseJID(toPhone)
	if err != nil {
		jid = types.NewJID(toPhone, types.DefaultUserServer)
	}
	_, err = s.client.SendMessage(ctx, jid, &waProto.Message{
		Conversation: proto.String(text),
	})
	if err != nil {
		return fmt.Errorf("sender: send text to %s: %w", toPhone, err)
	}
	return nil
}
