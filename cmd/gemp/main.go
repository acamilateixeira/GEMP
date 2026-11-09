package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/acamilateixeira/GEMP/internal/api"
	"github.com/acamilateixeira/GEMP/internal/credit"
)

func main() {
	addr := os.Getenv("GEMP_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           handler(credit.DemoProviders(), http.FileServer(http.Dir("dist"))),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("GEMP escutando em %s", addr)
	log.Fatal(server.ListenAndServe())
}

func handler(providers []credit.Provider, site http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/comparisons", func(w http.ResponseWriter, r *http.Request) {
		status, payload, ok := api.Compare(r.Context(), http.MaxBytesReader(w, r.Body, 4096), providers)
		if !ok {
			return // The client canceled the request.
		}
		writeJSON(w, status, payload)
	})
	mux.Handle("/", site)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("write response: %v", err)
	}
}
