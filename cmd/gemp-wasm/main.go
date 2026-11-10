//go:build js && wasm

// Command gemp-wasm runs the comparison in the browser. The online demo
// compiles this file to WebAssembly, so the page calls the same Go code the
// server uses, including the goroutines and the 250 ms deadline per provider.
package main

import (
	"context"
	"encoding/json"
	"strings"
	"syscall/js"

	"github.com/acamilateixeira/GEMP/internal/api"
	"github.com/acamilateixeira/GEMP/internal/credit"
)

// StatusCanceled mirrors the non-standard 499 ("client closed request") so the
// page can tell a cancellation apart from a failure. The HTTP server writes
// nothing in that case; here a promise must still settle.
const StatusCanceled = 499

func main() {
	providers := credit.DemoProviders()
	// gempCompare(body: string, signal?: AbortSignal) → Promise<{status, body}>
	compare := js.FuncOf(func(_ js.Value, args []js.Value) any {
		body := ""
		if len(args) > 0 {
			body = args[0].String()
		}
		var signal js.Value
		if len(args) > 1 && args[1].Truthy() {
			signal = args[1]
		}
		var executor js.Func
		executor = js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			// A blocking call inside a JS callback would freeze the page, so the work runs in a goroutine.
			go func() {
				defer executor.Release()
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				// The AbortSignal cancels the same context the providers receive, so an
				// abort stops the in-flight provider calls instead of hiding a result.
				if signal.Truthy() {
					if signal.Get("aborted").Bool() {
						cancel()
					}
					onAbort := js.FuncOf(func(js.Value, []js.Value) any { cancel(); return nil })
					defer onAbort.Release()
					signal.Call("addEventListener", "abort", onAbort, map[string]any{"once": true})
					defer signal.Call("removeEventListener", "abort", onAbort)
				}
				status, payload, ok := api.Compare(ctx, strings.NewReader(body), providers)
				if !ok {
					resolve.Invoke(map[string]any{"status": StatusCanceled, "body": `{"error":"canceled"}`})
					return
				}
				data, err := json.Marshal(payload)
				if err != nil {
					data = []byte(`{"error":"encode_failed"}`)
					status = 500
				}
				resolve.Invoke(map[string]any{"status": status, "body": string(data)})
			}()
			return nil
		})
		return js.Global().Get("Promise").New(executor)
	})
	js.Global().Set("gempCompare", compare)
	js.Global().Call("dispatchEvent", js.Global().Get("Event").New("gemp-ready"))
	select {}
}
