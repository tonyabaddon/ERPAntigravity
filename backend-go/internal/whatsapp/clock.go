package whatsapp

import "time"

// Clock abstracts time so tests can run deterministically with a fake clock.
type Clock interface {
	Now() time.Time
	AfterFunc(d time.Duration, f func()) Timer
}

// Timer abstracts time.Timer so fakes can implement Stop().
type Timer interface {
	Stop() bool
}

// realClock is the production implementation.
type realClock struct{}

func newRealClock() Clock { return realClock{} }

func (realClock) Now() time.Time { return time.Now() }
func (realClock) AfterFunc(d time.Duration, f func()) Timer {
	return time.AfterFunc(d, f)
}
