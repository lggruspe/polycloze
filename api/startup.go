// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"github.com/lggruspe/polycloze/basedir"
	"github.com/lggruspe/polycloze/database"
)

type Language struct {
	Code  string `json:"code"` // ISO 639-3
	Name  string `json:"name"` // in english
	BCP47 string `json:"bcp47"`
}

type Course struct {
	L1 Language `json:"l1"`
	L2 Language `json:"l2"`
}

// Look for installed languages and courses.
func Startup() {
	courses := findCourses()
	languages := findL1Languages(courses)
	if len(languages) <= 0 {
		log.Fatal("Couldn't find installed courses. Please visit https://github.com/lggruspe/polycloze/tree/main/python")
	}

	// Generate courses.json.
	coursesJSON := filepath.Join(basedir.StateDir, "courses.json")
	err := writeJSON(coursesJSON, map[string][]Course{
		"courses": courses,
	})
	if err != nil {
		log.Fatal("failed to write courses.json:", err)
	}

	// Generate languages.json
	languagesJSON := filepath.Join(basedir.StateDir, "languages.json")
	err = writeJSON(languagesJSON, map[string][]Language{
		"languages": languages,
	})
	if err != nil {
		log.Fatal("failed to write languages.json:", err)
	}

	// Generate word lists.
	path := filepath.Join(basedir.DataDir, "words")
	if err := os.MkdirAll(path, 0777); err != nil {
		log.Fatal("failed to get list of words:", err)
	}

	for _, course := range courses {
		db, err := database.Open(basedir.Course(course.L1.Code, course.L2.Code))
		if err != nil {
			log.Fatal("failed to get list of words:", err)
		}
		defer db.Close()

		query := `SELECT id, word, frequency_class FROM word`
		rows, err := db.Query(query)
		if err != nil {
			log.Fatal("failed to get list of words:", err)
		}
		defer rows.Close()

		f, err := os.Create(
			filepath.Join(
				path,
				fmt.Sprintf("%s-%s.csv", course.L1.Code, course.L2.Code),
			),
		)
		if err != nil {
			log.Fatal("failed to get list of words:", err)
		}
		defer f.Close()

		w := csv.NewWriter(f)
		if err := w.Write([]string{"id", "word", "frequency_class"}); err != nil {
			log.Fatal("failed to get list of words:", err)
		}

		for rows.Next() {
			var word string
			var id, frequencyClass int
			if err := rows.Scan(&id, &word, &frequencyClass); err != nil {
				log.Fatal("failed to get list of words:", err)
			}
			if err := w.Write([]string{strconv.Itoa(id), word, strconv.Itoa(frequencyClass)}); err != nil {
				log.Fatal("failed to get list of words:", err)
			}
		}
	}
}

// Input: path to course db file.
func getCourseInfo(path string) (Course, error) {
	var course Course

	db, err := database.Open(path)
	if err != nil {
		return course, fmt.Errorf("could not open db to get course info: %v", err)
	}
	defer db.Close()

	query := `select id, code, name, bcp47 from language`
	rows, err := db.Query(query)
	if err != nil {
		return course, fmt.Errorf("could not get course info: %v", err)
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
	return course, nil
}

// Look for installed courses in data directory.
func findCourses() []Course {
	var courses []Course
	matches, _ := filepath.Glob(filepath.Join(basedir.DataDir, "courses", "*.db"))
	for _, match := range matches {
		course, err := getCourseInfo(match)
		if err == nil {
			courses = append(courses, course)
		}
	}
	return courses
}

func findL1Languages(courses []Course) []Language {
	languages := make(map[Language]bool)
	for _, course := range courses {
		languages[course.L1] = true
	}

	var result []Language
	for language := range languages {
		result = append(result, language)
	}
	return result
}
