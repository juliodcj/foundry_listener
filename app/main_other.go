//go:build !windows

// On other systems the app runs as a small local web server, used to
// develop and test the UI; the real app is the Windows build.
package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
)

//go:embed ui/index.html
var indexHTML string

func hideWindow(cmd *exec.Cmd)  {}
func attachToJob(cmd *exec.Cmd) {}

func copyToClipboard(text string) error { return errors.New("área de transferência indisponível") }

func openURL(url string) error { return exec.Command("xdg-open", url).Start() }

func main() {
	addr := flag.String("addr", "127.0.0.1:8766", "endereço da interface de desenvolvimento")
	flag.Parse()
	app := NewApp()
	if app.AutoStart() {
		app.mgr.Start()
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		app.mgr.Stop()
		os.Exit(0)
	}()
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, indexHTML)
	})
	http.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		arg, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
		res, err := app.Call(strings.TrimPrefix(r.URL.Path, "/api/"), string(arg))
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(res)
	})
	fmt.Println("Interface em http://" + *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
