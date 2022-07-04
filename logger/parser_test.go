package logger

import (
	"testing"
	"time"
)

func TestParseLineCorrect(t *testing.T) {
	event, err := ParseLine("/ 2020-01-01 00:00:00 test")
	if err != nil {
		t.Fatal("expected err to be nil:", err)
	}

	if !event.Correct {
		t.Fatal("expected event.Correct to be true")
	}
}

func TestParseLineIncorrect(t *testing.T) {
	event, err := ParseLine("x 2020-01-01 00:00:00 test")
	if err != nil {
		t.Fatal("expected err to be nil:", err)
	}

	if event.Correct {
		t.Fatal("expected event.Correct to be false")
	}
}

func TestParseLineWord(t *testing.T) {
	event, err := ParseLine("/ 2020-01-01 00:00:00 Foo bar")
	if err != nil {
		t.Fatal("expected err to be nil:", err)
	}

	if event.Word != "Foo bar" {
		t.Fatal("expected event.Word to be equal to 'Foo bar':", event.Word)
	}
}

func TestParse(t *testing.T) {
	log := `/ 2021-01-01 01:02:03 foo
x 2022-02-02 01:02:03 bar
`
	events, err := Parse(log)
	if err != nil {
		t.Fatal("expected err to be nil:", err)
	}

	expected := []LogEvent{
		{
			Correct:   true,
			Timestamp: time.Date(2021, 01, 01, 1, 2, 3, 0, time.UTC),
			Word:      "foo",
		},
		{
			Correct:   false,
			Timestamp: time.Date(2022, 02, 02, 1, 2, 3, 0, time.UTC),
			Word:      "bar",
		},
	}

	if len(events) != len(expected) {
		t.Fatalf("expected events to be %v: %v\n", expected, events)
	}

	for i, event := range events {
		if event != expected[i] {
			t.Fatalf("expected events to be %v: %v\n", expected, events)
		}
	}
}