package events

import (
	"context"

	"github.com/navidrome/navidrome/model/request"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Broker", func() {
	var b broker

	BeforeEach(func() {
		b = broker{}
	})

	Describe("shouldSend", func() {
		var c client
		var ctx context.Context
		BeforeEach(func() {
			ctx = context.Background()
			c = client{
				clientUniqueId: "1111",
				username:       "janedoe",
			}
		})
		Context("request has clientUniqueId", func() {
			It("sends message for same username, different clientUniqueId", func() {
				ctx = request.WithClientUniqueId(ctx, "2222")
				ctx = request.WithUsername(ctx, "janedoe")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeTrue())
			})
			It("does not send message for same username, same clientUniqueId", func() {
				ctx = request.WithClientUniqueId(ctx, "1111")
				ctx = request.WithUsername(ctx, "janedoe")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeFalse())
			})
			It("does not send message for different username", func() {
				ctx = request.WithClientUniqueId(ctx, "3333")
				ctx = request.WithUsername(ctx, "johndoe")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeFalse())
			})
		})
		Context("request does not have clientUniqueId", func() {
			It("sends message for same username", func() {
				ctx = request.WithUsername(ctx, "janedoe")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeTrue())
			})
			It("does not send message for different username", func() {
				ctx = request.WithUsername(ctx, "johndoe")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeFalse())
			})
			It("sends message when no username is set", func() {
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeTrue())
			})
		})

		Context("request has targetClientUniqueId", func() {
			It("sends only to the targeted device for the same user", func() {
				ctx = request.WithUsername(ctx, "janedoe")
				ctx = request.WithTargetClientUniqueId(ctx, "1111")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeTrue())
			})

			It("does not send to other devices when targeted", func() {
				ctx = request.WithUsername(ctx, "janedoe")
				ctx = request.WithTargetClientUniqueId(ctx, "9999")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeFalse())
			})

			It("still delivers to the target when the sender and target client ids match", func() {
				ctx = request.WithUsername(ctx, "janedoe")
				ctx = request.WithClientUniqueId(ctx, "1111")
				ctx = request.WithTargetClientUniqueId(ctx, "1111")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeTrue())
			})

			It("does not send targeted events across users", func() {
				ctx = request.WithUsername(ctx, "johndoe")
				ctx = request.WithTargetClientUniqueId(ctx, "1111")
				m := message{senderCtx: ctx}
				Expect(b.shouldSend(m, c)).To(BeFalse())
			})
		})
	})
})
