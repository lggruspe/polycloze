// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/polycloze/polycloze/auth"
	"github.com/polycloze/polycloze/sessions"
)

// Middleware
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		next.ServeHTTP(w, r)
	})
}

func handleHome(w http.ResponseWriter, r *http.Request) {
	// Check if user is signed in.
	db := auth.GetDB(r)
	s, err := sessions.StartOrResumeSession(db, w, r)

	if err != nil || !s.IsSignedIn() {
		http.Redirect(w, r, "/about", http.StatusTemporaryRedirect)
		return
	}

	// Get active course.
	userID := s.Data["userID"].(int)
	course, err := getUserActiveCourse(userID)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	s.Data["course"] = course
	s.Data["csrfToken"] = sessions.CSRFToken(s.ID)
	renderTemplate(w, "home.html", s.Data)
}

func handleAbout(w http.ResponseWriter, r *http.Request) {
	var data map[string]any
	db := auth.GetDB(r)
	if s, err := sessions.StartOrResumeSession(db, w, r); err == nil {
		data = s.Data

		if s.IsSignedIn() {
			// Get active course.
			userID := data["userID"].(int)
			course, err := getUserActiveCourse(userID)
			if err != nil {
				log.Println(err)
				http.Error(w, "Something went wrong.", http.StatusInternalServerError)
				return
			}
			data["course"] = course
		}
	}
	renderTemplate(w, "about.html", data)
}

func handleStudy(w http.ResponseWriter, r *http.Request) {
	db := auth.GetDB(r)
	s, err := sessions.ResumeSession(db, w, r)
	if err != nil || !s.IsSignedIn() {
		http.Redirect(w, r, "/signin", http.StatusTemporaryRedirect)
		return
	}

	// Get active course.
	userID := s.Data["userID"].(int)
	course, err := getUserActiveCourse(userID)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}

	s.Data["course"] = course
	s.Data["csrfToken"] = sessions.CSRFToken(s.ID)
	renderTemplate(w, "study.html", s.Data)
}

func handleVocabularyPage(w http.ResponseWriter, r *http.Request) {
	db := auth.GetDB(r)
	s, err := sessions.ResumeSession(db, w, r)
	if err != nil || !s.IsSignedIn() {
		http.Redirect(w, r, "/signin", http.StatusTemporaryRedirect)
		return
	}

	// Get active course.
	userID := s.Data["userID"].(int)
	course, err := getUserActiveCourse(userID)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}

	s.Data["course"] = course
	s.Data["csrfToken"] = sessions.CSRFToken(s.ID)
	renderTemplate(w, "vocab.html", s.Data)
}

// db: user DB for authentication
func Router(config Config, db *sql.DB) (chi.Router, error) {
	r := chi.NewRouter()
	if config.AllowCORS {
		r.Use(cors)
	}
	r.Use(middleware.Logger)
	r.Use(auth.Middleware(db))

	r.HandleFunc("/", handleHome)
	r.HandleFunc("/study", handleStudy)
	r.HandleFunc("/vocab", handleVocabularyPage)
	r.HandleFunc("/about", handleAbout)
	r.HandleFunc("/welcome", handleWelcome)
	r.HandleFunc("/settings", handleSettings)

	r.HandleFunc("/register", handleRegister)
	r.HandleFunc("/signin", handleSignIn)
	r.HandleFunc("/signout", handleSignOut)

	r.Handle("/dist/*", http.StripPrefix("/dist/", serveDist()))
	r.Handle("/public/*", http.StripPrefix("/public/", servePublic()))
	r.Handle("/share/*", http.StripPrefix("/share/", serveShare()))
	r.Handle("/svg/*", http.StripPrefix("/svg/", serveSVG()))
	r.Handle("/personal/*", http.StripPrefix("/personal/", http.HandlerFunc(serveUserData)))

	// serviceworker has to be at the root.
	r.Handle("/serviceworker.js*", http.StripPrefix("/", serveDist()))
	r.Handle("/robots.txt", http.StripPrefix("/", servePublic()))

	r.HandleFunc("/api/sentences", handleSentences)

	r.HandleFunc("/api/flashcards/{l1}/{l2}", handleFlashcards)
	r.HandleFunc("/api/vocabulary/{l1}/{l2}", handleVocabulary)
	r.HandleFunc("/api/stats/activity/{l1}/{l2}", handleStatsActivity)
	r.HandleFunc("/api/stats/vocab/{l1}/{l2}", handleStatsVocab)
	r.HandleFunc("/api/stats/estimate/{l1}/{l2}", handleStatsEstimatedLevel)

	r.HandleFunc("/api/languages", serveLanguagesJSON())
	r.HandleFunc("/api/courses", serveCoursesJSON())

	r.HandleFunc("/api/actions/set-course", handleSetCourse)
	r.HandleFunc("/api/settings/upload/{l1}/{l2}", handleUpload)
	r.HandleFunc("/api/settings/reset/{l1}/{l2}", handleResetProgress)

	r.HandleFunc("/api/wordlist/{l1}/{l2}", handleWordLists)
	r.HandleFunc("/api/wordlist/{l1}/{l2}/{id}", handleWordListWords)
	return r, nil
}
