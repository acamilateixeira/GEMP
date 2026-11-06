package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"time"

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
		var input credit.Request
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || !input.Valid() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := credit.Compare(r.Context(), input, providers, 250*time.Millisecond)
		if err != nil {
			return // The client canceled the request.
		}
		status := http.StatusOK
		if result.Status == "unavailable" {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, result)
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
