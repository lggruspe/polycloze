// Log parser
package logger

import (
	"errors"
	"os"
	"strings"
	"time"
)

var ErrParseError = errors.New("parse error")

type LogEvent struct {
	Correct   bool
	Timestamp time.Time
	Word      string
}

func ParseLine(line string) (LogEvent, error) {
	var event LogEvent

	switch line[:2] {
	case "x ":
		event.Correct = false
		line = line[2:]
	case "/ ":
		event.Correct = true
		line = line[2:]
	default:
		return event, ErrParseError
	}

	layout := "2006-01-02 15:04:05"
	timestamp, err := time.Parse(layout, line[:len(layout)])
	if err != nil {
		return event, err
	}
	event.Timestamp = timestamp
	line = line[len(layout):]

	event.Word = line[1:]
	return event, nil
}

func Parse(s string) ([]LogEvent, error) {
	var events []LogEvent

	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(s), "\r\n", "\n"), "\n")
	for _, line := range lines {
		event, err := ParseLine(line)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, nil
}

func ParseFile(path string) ([]LogEvent, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(string(bytes))
}