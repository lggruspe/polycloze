// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package basedir

import (
	"fmt"
	"path"
)

// Returns path to user's files.
// Doesn't check if the path exists.
func User(userID int) string {
	return path.Join(StateDir, "users", fmt.Sprintf("%v", userID))
}

// Returns path to review database.
// l1 and l2: ISO 639-3 code
func Review(userID int, l1, l2 string) string {
	return path.Join(User(userID), "reviews", fmt.Sprintf("%s-%s.db", l1, l2))
}

// Returns path to database for course.
// l1 and l2 are ISO 639-3 codes.
func Course(l1, l2 string) string {
	return path.Join(DataDir, "courses", fmt.Sprintf("%s-%s.db", l1, l2))
}

// Returns path to sync db.
// l1 and l2: ISO 639-3 code.
func Sync(userID int, l1, l2 string) string {
	return path.Join(User(userID), "sync", fmt.Sprintf("%s-%s.db", l1, l2))
}

func Users() string {
	return path.Join(StateDir, "users.db")
}
