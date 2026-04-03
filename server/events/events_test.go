package events

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Events", func() {
	Describe("Event", func() {
		type TestEvent struct {
			baseEvent
			Test string
		}

		It("marshals Event to JSON", func() {
			testEvent := TestEvent{Test: "some data"}
			data := testEvent.Data(&testEvent)
			Expect(data).To(Equal(`{"Test":"some data"}`))
			name := testEvent.Name(&testEvent)
			Expect(name).To(Equal("testEvent"))
		})
	})

	Describe("RefreshResource", func() {
		var rr *RefreshResource
		BeforeEach(func() {
			rr = &RefreshResource{}
		})

		It("should render to full refresh if event is empty", func() {
			data := rr.Data(rr)
			Expect(data).To(Equal(`{"*":"*"}`))
		})
		It("should group resources based on name", func() {
			rr.With("album", "al-1").With("song", "sg-1").With("artist", "ar-1")
			rr.With("album", "al-2", "al-3").With("song", "sg-2").With("artist", "ar-2")
			data := rr.Data(rr)
			Expect(data).To(Equal(`{"album":["al-1","al-2","al-3"],"artist":["ar-1","ar-2"],"song":["sg-1","sg-2"]}`))
		})
		It("should send a * when no ids are specified", func() {
			rr.With("album")
			data := rr.Data(rr)
			Expect(data).To(Equal(`{"album":["*"]}`))
		})
	})

	Describe("Connect events", func() {
		It("keeps zero positions in connect command payloads", func() {
			event := &ConnectCommand{
				ForUser:        "alice",
				TargetDeviceId: "device-1",
				Command:        "seek",
				PositionMs:     0,
			}

			Expect(event.Data(event)).To(Equal(`{"forUser":"alice","targetDeviceId":"device-1","command":"seek","positionMs":0}`))
		})

		It("keeps zero positions in connect state payloads", func() {
			event := &ConnectStateChanged{
				ForUser:    "alice",
				DeviceId:   "device-1",
				TrackId:    "track-1",
				State:      "playing",
				PositionMs: 0,
			}

			Expect(event.Data(event)).To(Equal(`{"forUser":"alice","deviceId":"device-1","trackId":"track-1","state":"playing","positionMs":0}`))
		})
	})
})
