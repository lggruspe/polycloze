// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"log"
	"net/http"
)

func showPage(name string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := newTemplateData(r)
		if err != nil {
			log.Println(err)
		}
		if err := renderTemplate(w, name, &data); err != nil {
			log.Println(err)
		}
	}
}
