package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/syslog"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/csrf"
	"tailscale.com/client/tailscale"
	"tailscale.com/client/web"
	"tailscale.com/hostinfo"
	"tailscale.com/ipn"
	"tailscale.com/net/proxymux"
	"tailscale.com/net/socks5"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/types/logger"
	"tailscale.com/types/netmap"
)

var (
	installFlag   = flag.String("install", "", "register the browser extension; string is 'C' (Chrome) or 'F' (Firefox) followed by extension ID")
	uninstallFlag = flag.Bool("uninstall", false, "unregister the browser extension")
)

func main() {
	flag.Parse()
	if *installFlag != "" {
		if err := install(*installFlag); err != nil {
			log.Fatalf("installation error: %v", err)
		}
		return
	}
	if *uninstallFlag {
		if err := uninstall(); err != nil {
			log.Fatalf("uninstallation error: %v", err)
		}
		return
	}

	if flag.NArg() == 0 {
		fmt.Printf(`ts-browser-ext is the backend for the Tailscale browser extension,
running as a child process HTTP/SOCKS5 under your browser.

To register it for Chrome, run:
     $ ts-browser-ext --install=C<extension-id>

To register it for Firefox, run:
     $ ts-browser-ext --install=F
`)
		return
	}

	hostinfo.SetApp("ts-browser-ext")

	h := newHost(os.Stdin, os.Stdout)

	if w, err := syslog.Dial("tcp", "localhost:5555", syslog.LOG_INFO, "browser"); err == nil {
		log.Printf("syslog dialed")
		h.logf = func(f string, a ...any) {
			fmt.Fprintf(w, f, a...)
		}
		log.SetOutput(w)
	} else {
		log.Printf("syslog: %v", err)
	}

	ln := h.getProxyListener()
	port := ln.Addr().(*net.TCPAddr).Port
	h.logf("Proxy listening on localhost:%v", port)

	h.send(&reply{ProcRunning: &procRunningResult{
		Port: port,
		Pid:  os.Getpid(),
	}})
	h.logf("Starting readMessages loop")
	err := h.readMessages()
	h.logf("readMessage loop ended: %v", err)
}

func getTargetDir(browserByte string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	var dir string
	switch runtime.GOOS {
	case "linux":
		if browserByte == "C" {
			dir = filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts")
		} else if browserByte == "F" {
			dir = filepath.Join(home, ".mozilla", "native-messaging-hosts")
		}
	case "darwin":
		if browserByte == "C" {
			dir = filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
		} else if browserByte == "F" {
			dir = filepath.Join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts")
		}
	default:
		return "", fmt.Errorf("TODO: implement support for installing on %q", runtime.GOOS)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func uninstall() error {
	for _, browserByte := range []string{"C", "F"} {
		targetDir, err := getTargetDir(browserByte)
		if err != nil {
			return err
		}
		targetBin := filepath.Join(targetDir, "ts-browser-ext")
		targetJSON := filepath.Join(targetDir, "com.tailscale.browserext.chrome.json")
		if browserByte == "F" {
			targetJSON = filepath.Join(targetDir, "com.tailscale.browserext.firefox.json")
		}
		if err := os.Remove(targetBin); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Remove(targetJSON); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func install(installArg string) error {
	browserByte := installArg[0:1]
	extension := ""
	if len(installArg) > 1 {
		extension = installArg[1:]
	}
	
	switch browserByte {
	case "C":
		if !regexp.MustCompile(`^[a-z0-9]{32}$`).MatchString(extension) {
			return fmt.Errorf("invalid Chrome extension ID %q", extension)
		}
	case "F":
		// Firefox doesn't need extension ID validation
	default:
		return fmt.Errorf("unknown browser prefix byte %q", browserByte)
	}
	
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	targetDir, err := getTargetDir(browserByte)
	if err != nil {
		return err
	}
	binary, err := os.ReadFile(exe)
	if err != nil {
		return err
	}
	targetBin := filepath.Join(targetDir, "ts-browser-ext")
	if err := os.WriteFile(targetBin, binary, 0755); err != nil {
		return err
	}
	log.SetFlags(0)
	log.Printf("copied binary to %v", targetBin)

	var targetJSON string
	var jsonConf []byte

	switch browserByte {
	case "C":
		targetJSON = filepath.Join(targetDir, "com.tailscale.browserext.chrome.json")
		jsonConf = fmt.Appendf(nil, `{
		"name": "com.tailscale.browserext.chrome",
		"description": "Tailscale Browser Extension",
		"path": "%s",
		"type": "stdio",
		"allowed_origins": [
			"chrome-extension://%s/"
		]
	  }`, targetBin, extension)
	case "F":
		targetJSON = filepath.Join(targetDir, "com.tailscale.browserext.firefox.json")
		jsonConf = fmt.Appendf(nil, `{
		"name": "com.tailscale.browserext.firefox",
		"description": "Tailscale Browser Extension",
		"path": "%s",
		"type": "stdio",
		"allowed_extensions": [
			"browser-ext@tailscale.com"
		]
	  }`, targetBin)
	}
	
	if err := os.WriteFile(targetJSON, jsonConf, 0644); err != nil {
		return err
	}
	log.Printf("wrote registration to %v", targetJSON)
	return nil
}

type host struct {
	br   *bufio.Reader
	w    io.Writer
	logf logger.Logf

	wmu sync.Mutex

	lenBuf [4]byte

	mu              sync.Mutex
	watchDead       bool
	lastNetmap      *netmap.NetworkMap
	lastState       ipn.State
	lastBrowseToURL string
	lastPrefs       *ipn.Prefs
	ctx             context.Context
	cancelCtx       context.CancelFunc
	ts              *tsnet.Server
	ws              *web.Server
	ln              net.Listener
	wantUp          bool
}

func newHost(r io.Reader, w io.Writer) *host {
	h := &host{
		br:   bufio.NewReaderSize(r, 1<<20),
		w:    w,
		logf: log.Printf,
	}
	h.ts = &tsnet.Server{
		RunWebClient: true,
		Logf: func(f string, a ...any) {
			h.logf(f, a...)
		},
	}
	return h
}

const maxMsgSize = 1 << 20

func (h *host) readMessages() error {
	for {
		msg, err := h.readMessage()
		if err != nil {
			return err
		}
		if err := h.handleMessage(msg); err != nil {
			h.logf("error handling message %v: %v", msg, err)
			return err
		}
	}
}

func (h *host) handleMessage(msg *request) error {
	switch msg.Cmd {
	case CmdInit:
		return h.handleInit(msg)
	case CmdGetStatus:
		h.sendStatus()
	case CmdUp:
		return h.handleUp()
	case CmdDown:
		return h.handleDown()
	case CmdSetExitNode:
		return h.handleSetExitNode(msg.ExitNodeID)
	case CmdClearExitNode:
		return h.handleClearExitNode()
	default:
		h.logf("unknown command %q", msg.Cmd)
	}
	return nil
}

func (h *host) handleUp() error {
	return h.setWantRunning(true)
}

func (h *host) handleDown() error {
	return h.setWantRunning(false)
}

func (h *host) setWantRunning(want bool) error {
	defer h.sendStatus()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.ts.Sys() == nil {
		return fmt.Errorf("not init")
	}
	h.wantUp = want
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	lc, err := h.ts.LocalClient()
	if err != nil {
		return err
	}
	if _, err := lc.EditPrefs(ctx, &ipn.MaskedPrefs{
		WantRunningSet: true,
		Prefs: ipn.Prefs{
			WantRunning: want,
		},
	}); err != nil {
		return fmt.Errorf("EditPrefs to wantRunning=%v: %w", want, err)
	}
	return nil
}

func (h *host) handleSetExitNode(exitNodeID string) error {
	defer h.sendStatus()
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if h.ts.Sys() == nil {
		return fmt.Errorf("not init")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	lc, err := h.ts.LocalClient()
	if err != nil {
		return err
	}

	var exitNodeStableID tailcfg.StableNodeID
	if exitNodeID != "" {
		exitNodeStableID = tailcfg.StableNodeID(exitNodeID)
	}

	if _, err := lc.EditPrefs(ctx, &ipn.MaskedPrefs{
		ExitNodeIDSet: true,
		Prefs: ipn.Prefs{
			ExitNodeID: exitNodeStableID,
		},
	}); err != nil {
		return fmt.Errorf("EditPrefs to set exit node: %w", err)
	}
	
	h.logf("Set exit node to: %s", exitNodeID)
	return nil
}

func (h *host) handleClearExitNode() error {
	defer h.sendStatus()
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if h.ts.Sys() == nil {
		return fmt.Errorf("not init")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	lc, err := h.ts.LocalClient()
	if err != nil {
		return err
	}

	if _, err := lc.EditPrefs(ctx, &ipn.MaskedPrefs{
		ExitNodeIDSet: true,
		Prefs: ipn.Prefs{
			ExitNodeID: "",
		},
	}); err != nil {
		return fmt.Errorf("EditPrefs to clear exit node: %w", err)
	}
	
	h.logf("Cleared exit node")
	return nil
}

func (h *host) handleInit(msg *request) (ret error) {
	defer func() {
		var errMsg string
		if ret != nil {
			errMsg = ret.Error()
		}
		h.send(&reply{
			Init: &initResult{Error: errMsg},
		})
	}()
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.cancelCtx != nil {
		h.cancelCtx()
	}
	h.ctx, h.cancelCtx = context.WithCancel(context.Background())

	id := msg.InitID
	if len(id) == 0 {
		return fmt.Errorf("missing initID")
	}
	if len(id) > 60 {
		return fmt.Errorf("initID too long")
	}
	for i := 0; i < len(id); i++ {
		b := id[i]
		if b == '-' || (b >= 'a' && b <= 'f') || (b >= '0' && b <= '9') {
			continue
		}
		return errors.New("invalid initID character")
	}

	if h.ts.Sys() != nil {
		return fmt.Errorf("already running")
	}
	u, err := user.Current()
	if err != nil {
		return fmt.Errorf("getting current user: %w", err)
	}
	h.ts.Hostname = u.Username + "-browser-ext"

	confDir, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("getting user config dir: %w", err)
	}
	h.ts.Dir = filepath.Join(confDir, "tailscale-browser-ext", id)

	h.logf("Starting...")
	if err := h.ts.Start(); err != nil {
		return fmt.Errorf("starting tsnet.Server: %w", err)
	}
	h.logf("Started")

	lc, err := h.ts.LocalClient()
	if err != nil {
		return fmt.Errorf("getting local client: %w", err)
	}

	wc, err := lc.WatchIPNBus(h.ctx, ipn.NotifyInitialState|ipn.NotifyRateLimit)
	if err != nil {
		return fmt.Errorf("watching IPN bus: %w", err)
	}
	go h.watchIPNBus(wc)

	h.ws, err = web.NewServer(web.ServerOpts{
		Mode:        web.LoginServerMode,
		LocalClient: lc,
	})
	if err != nil {
		return fmt.Errorf("NewServer: %w", err)
	}

	return nil
}

func (h *host) watchIPNBus(wc *tailscale.IPNBusWatcher) {
	h.mu.Lock()
	h.watchDead = false
	h.mu.Unlock()

	for h.updateFromWatcher(wc) {
	}
}

func (h *host) updateFromWatcher(wc *tailscale.IPNBusWatcher) bool {
	n, err := wc.Next()
	defer h.sendStatus()
	h.mu.Lock()
	defer h.mu.Unlock()

	if err != nil {
		log.Printf("watchIPNBus: %v", err)
		h.watchDead = true
		return false
	}

	if n.NetMap != nil {
		h.lastNetmap = n.NetMap
	}
	if n.State != nil {
		h.lastState = *n.State
	}
	if n.Prefs != nil {
		prefs := n.Prefs.AsStruct() // Fix for PrefsView
		h.lastPrefs = prefs
	}
	if n.BrowseToURL != nil {
		h.lastBrowseToURL = *n.BrowseToURL
	}
	return true
}

func (h *host) send(msg *reply) error {
	msgb, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("json encoding of message: %w", err)
	}
	h.logf("sent reply: %s", msgb)
	if len(msgb) > maxMsgSize {
		return fmt.Errorf("message too big (%v)", len(msgb))
	}
	binary.LittleEndian.PutUint32(h.lenBuf[:], uint32(len(msgb)))
	h.wmu.Lock()
	defer h.wmu.Unlock()
	if _, err := h.w.Write(h.lenBuf[:]); err != nil {
		return err
	}
	if _, err := h.w.Write(msgb); err != nil {
		return err
	}
	return nil
}

func (h *host) getProxyListener() net.Listener {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.getProxyListenerLocked()
}

func (h *host) getProxyListenerLocked() net.Listener {
	if h.ln != nil {
		return h.ln
	}
	var err error
	h.ln, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	socksListener, httpListener := proxymux.SplitSOCKSAndHTTP(h.ln)

	hs := &http.Server{Handler: h.httpProxyHandler()}
	go func() {
		log.Fatalf("HTTP proxy exited: %v", hs.Serve(httpListener))
	}()
	ss := &socks5.Server{
		Logf:   logger.WithPrefix(h.logf, "socks5: "),
		Dialer: h.userDial,
	}
	go func() {
		log.Fatalf("SOCKS5 server exited: %v", ss.Serve(socksListener))
	}()
	return h.ln
}

func (h *host) userDial(ctx context.Context, netw, addr string) (net.Conn, error) {
	h.mu.Lock()
	sys := h.ts.Sys()
	h.mu.Unlock()

	if sys == nil {
		h.logf("userDial to %v/%v without a tsnet.Server started", netw, addr)
		return nil, fmt.Errorf("no tsnet.Server")
	}

	return sys.Dialer.Get().UserDial(ctx, netw, addr)
}

func (h *host) sendStatus() {
	st := &status{}
	h.mu.Lock()
	st.Running = h.lastState == ipn.Running
	if nm := h.lastNetmap; nm != nil {
		st.Tailnet = nm.Domain

		if h.lastPrefs != nil && h.lastPrefs.ExitNodeID != "" {
			st.ExitNodeID = string(h.lastPrefs.ExitNodeID)
			for _, peer := range nm.Peers {
				if peer.StableID() == h.lastPrefs.ExitNodeID {
					st.ExitNodeName = peer.DisplayName(false)
					break
				}
			}
		}

		st.AvailableExitNodes = []exitNodeInfo{}
		for _, peer := range nm.Peers {
			isExitNode := false
			for i := 0; i < peer.AllowedIPs().Len(); i++ {
				ip := peer.AllowedIPs().At(i)
				if ip.String() == "0.0.0.0/0" || ip.String() == "::/0" {
					isExitNode = true
					break
				}
			}
			if isExitNode {
				isActive := false
				if h.lastPrefs != nil {
					isActive = h.lastPrefs.ExitNodeID == peer.StableID()
				}
				st.AvailableExitNodes = append(st.AvailableExitNodes, exitNodeInfo{
					ID:     string(peer.StableID()),
					Name:   peer.DisplayName(false),
					Active: isActive,
				})
			}
		}
	}
	if h.lastState == ipn.NeedsLogin {
		st.NeedsLogin = true
		st.BrowseToURL = h.lastBrowseToURL
	} else if !st.Running {
		st.Error = "State: " + h.lastState.String()
	}
	if h.watchDead {
		st.Error = "WatchIPNBus stopped"
	}
	h.mu.Unlock()

	if err := h.send(&reply{Status: st}); err != nil {
		h.logf("failed to send status: %v", err)
	}
}

type Cmd string

const (
	CmdInit          Cmd = "init"
	CmdUp            Cmd = "up"
	CmdDown          Cmd = "down"
	CmdGetStatus     Cmd = "get-status"
	CmdSetExitNode   Cmd = "set-exit-node"
	CmdClearExitNode Cmd = "clear-exit-node"
)

type request struct {
	Cmd        Cmd    `json:"cmd"`
	InitID     string `json:"initID,omitempty"`
	ExitNodeID string `json:"exitNodeID,omitempty"`
}

type reply struct {
	ProcRunning *procRunningResult `json:"procRunning,omitempty"`
	Status      *status            `json:"status,omitempty"`
	Init        *initResult        `json:"init,omitempty"`
}

type procRunningResult struct {
	Port  int    `json:"port"`
	Pid   int    `json:"pid"`
	Error string `json:"error"`
}

type initResult struct {
	Error string `json:"error"`
}

type status struct {
	Running            bool           `json:"running"`
	Tailnet            string         `json:"tailnet"`
	Error              string         `json:"error,omitempty"`
	NeedsLogin         bool           `json:"needsLogin,omitempty"`
	BrowseToURL        string         `json:"browseToURL"`
	ExitNodeID         string         `json:"exitNodeID,omitempty"`
	ExitNodeName       string         `json:"exitNodeName,omitempty"`
	AvailableExitNodes []exitNodeInfo `json:"availableExitNodes,omitempty"`
}

type exitNodeInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

func (h *host) readMessage() (*request, error) {
	if _, err := io.ReadFull(h.br, h.lenBuf[:]); err != nil {
		return nil, err
	}
	msgSize := binary.LittleEndian.Uint32(h.lenBuf[:])
	if msgSize > maxMsgSize {
		return nil, fmt.Errorf("message size too big (%v)", msgSize)
	}
	msgb := make([]byte, msgSize)
	if n, err := io.ReadFull(h.br, msgb); err != nil {
		return nil, fmt.Errorf("read %v of %v bytes in message with error %v", n, msgSize, err)
	}
	msg := new(request)
	if err := json.Unmarshal(msgb, msg); err != nil {
		return nil, fmt.Errorf("invalid JSON decoding of message: %w", err)
	}
	h.logf("got command %q: %s", msg.Cmd, msgb)
	return msg, nil
}

func (h *host) httpProxyHandler() http.Handler {
	rp := &httputil.ReverseProxy{
		Director: func(r *http.Request) {},
		Transport: &http.Transport{
			DialContext: h.userDial,
		},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "100.100.100.100" {
			h.ws.ServeHTTP(w, csrf.PlaintextHTTPRequest(r))
			return
		}

		if r.Method != "CONNECT" {
			backURL := r.RequestURI
			if strings.HasPrefix(backURL, "/") || backURL == "*" {
				http.Error(w, "bogus RequestURI; must be absolute URL or CONNECT", 400)
				return
			}
			rp.ServeHTTP(w, r)
			return
		}

		dst := r.RequestURI
		c, err := h.userDial(r.Context(), "tcp", dst)
		if err != nil {
			w.Header().Set("Tailscale-Connect-Error", err.Error())
			http.Error(w, err.Error(), 500)
			return
		}
		defer c.Close()

		cc, ccbuf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer cc.Close()

		io.WriteString(cc, "HTTP/1.1 200 OK\r\n\r\n")

		var clientSrc io.Reader = ccbuf
		if ccbuf.Reader.Buffered() == 0 {
			clientSrc = cc
		}

		errc := make(chan error, 1)
		go func() {
			_, err := io.Copy(cc, c)
			errc <- err
		}()
		go func() {
			_, err := io.Copy(c, clientSrc)
			errc <- err
		}()
		<-errc
	})
}