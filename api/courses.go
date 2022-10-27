// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/lggruspe/polycloze/basedir"
	"github.com/lggruspe/polycloze/database"
)

type Language struct {
	Code  string `json:"code"` // ISO 639-3
	Name  string `json:"name"` // in english
	BCP47 string `json:"bcp47"`
}

// Only used for encoding to json
type Languages struct {
	Languages []Language `json:"languages"`
}

type Course struct {
	L1    Language     `json:"l1"`
	L2    Language     `json:"l2"`
	Stats *CourseStats `json:"stats,omitempty"`
}

// Only used for encoding to json
type Courses struct {
	Courses []Course `json:"courses"`
}

func courseGlobPattern(l1, l2 string) string {
	if len(l1) != 3 {
		l1 = "[a-z][a-z][a-z]"
	}
	if len(l2) != 3 {
		l2 = "[a-z][a-z][a-z]"
	}
	return fmt.Sprintf("%s-%s.db", l1, l2)
}

func AvailableCourses(l1, l2 string, includeStats bool) []Course {
	var courses []Course

	glob := courseGlobPattern(l1, l2)
	matches, _ := filepath.Glob(filepath.Join(basedir.DataDir, glob))
	for _, match := range matches {
		course, err := getCourseInfo(match, includeStats)
		if err == nil {
			courses = append(courses, course)
		}
	}
	return courses
}

// Checks if course exists.
func courseExists(l1, l2 string) bool {
	path := basedir.Course(l1, l2)
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// Input: path to course db file.
func getCourseInfo(path string, includeStats bool) (Course, error) {
	var course Course

	db, err := database.Open(path)
	if err != nil {
		return course, fmt.Errorf("could not open db to get course info: %v", err)
	}
	defer db.Close()

	query := `select id, code, name, bcp47 from language`
	rows, err := db.Query(query)
	if err != nil {
		return course, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, code, name, bcp47 string
		if err := rows.Scan(&id, &code, &name, &bcp47); err != nil {
			return course, err
		}

		switch id {
		case "l1":
			course.L1.Code = code
			course.L1.Name = name
			course.L1.BCP47 = bcp47
		case "l2":
			course.L2.Code = code
			course.L2.Name = name
			course.L2.BCP47 = bcp47
		}
	}

	if course.L1.Code == "" || course.L2.Code == "" {
		return course, fmt.Errorf("invalid course database: %s\n", path)
	}

	if includeStats {
		stats, err := getCourseStats(course.L1.Code, course.L2.Code)
		if err != nil {
			return course, err
		}
		course.Stats = stats
	}

	return course, nil
}

func courseOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	q := r.URL.Query()
	courses := Courses{
		Courses: AvailableCourses(
			q.Get("l1"),
			q.Get("l2"),
			q.Get("stats") == "true",
		),
	}
	bytes, err := json.Marshal(courses)
	if err != nil {
		log.Fatal(err)
	}

	if _, err := w.Write(bytes); err != nil {
		log.Println(err)
	}
}
