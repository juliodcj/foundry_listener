package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Phase string

const (
	PhaseStopped    Phase = "stopped"
	PhaseInstalling Phase = "installing"
	PhaseStarting   Phase = "starting"
	PhaseRunning    Phase = "running"
	PhaseError      Phase = "error"
)

const ipcPrefix = "@@OUVIDOR "

// Minimum Node for @discordjs/voice.
const minNodeMajor, minNodeMinor = 22, 12

type Event struct {
	Time int64  `json:"t"`
	Kind string `json:"kind"` // info | ok | warn | err | speak
	Text string `json:"text"`
}

// State is everything the UI shows. Bot is the last status line the bot
// sent, passed through as-is.
type State struct {
	Phase       Phase           `json:"phase"`
	Message     string          `json:"message"`
	ErrorKind   string          `json:"errorKind"`
	Bot         json.RawMessage `json:"bot"`
	RunningAt   int64           `json:"runningAt"`
	Restarts    int             `json:"restarts"`
	NodeVersion string          `json:"nodeVersion"`
	BotDir      string          `json:"botDir"`
	FoundryUp   *bool           `json:"foundryUp"`
	FoundryPort int             `json:"foundryPort"`
	Events      []Event         `json:"events"`
}

type Manager struct {
	mu        sync.Mutex
	st        State
	cfg       Config
	gen       int
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	exited    chan struct{}
	fatalKind string
	fatalText string
	lastErr   string
}

func NewManager(cfg Config) *Manager {
	m := &Manager{cfg: cfg}
	m.st.Phase = PhaseStopped
	m.st.FoundryPort = cfg.FoundryPort
	if err := cfg.Validate(); err != nil {
		m.st.Message = err.Error()
	}
	go m.watchFoundry()
	return m
}

func (m *Manager) addEventLocked(kind, text string) {
	m.st.Events = append(m.st.Events, Event{Time: time.Now().UnixMilli(), Kind: kind, Text: text})
	if n := len(m.st.Events); n > 200 {
		m.st.Events = m.st.Events[n-200:]
	}
}

func (m *Manager) Snapshot() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.st
	s.Events = append([]Event(nil), m.st.Events...)
	return s
}

func (m *Manager) SetConfig(cfg Config) {
	m.mu.Lock()
	m.cfg = cfg
	if m.st.FoundryPort != cfg.FoundryPort {
		m.st.FoundryPort = cfg.FoundryPort
		m.st.FoundryUp = nil
	}
	if m.st.Phase == PhaseStopped || (m.st.Phase == PhaseError && m.st.ErrorKind == "config") {
		if err := cfg.Validate(); err != nil {
			m.st.Message = err.Error()
		} else {
			m.st.Message = ""
			if m.st.Phase == PhaseError {
				m.st.Phase = PhaseStopped
				m.st.ErrorKind = ""
			}
		}
	}
	m.mu.Unlock()
}

func (m *Manager) Running() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.st.Phase == PhaseStarting || m.st.Phase == PhaseRunning || m.st.Phase == PhaseInstalling
}

func (m *Manager) Start() {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch m.st.Phase {
	case PhaseStarting, PhaseRunning, PhaseInstalling:
		return
	}
	if err := m.cfg.Validate(); err != nil {
		m.st.Phase = PhaseError
		m.st.ErrorKind = "config"
		m.st.Message = err.Error()
		return
	}
	m.gen++
	m.st.Restarts = 0
	m.beginLocked(m.gen)
}

func (m *Manager) beginLocked(gen int) {
	m.st.Phase = PhaseStarting
	m.st.ErrorKind = ""
	m.st.Message = "Abrindo o bot…"
	m.st.Bot = nil
	m.st.RunningAt = 0
	m.fatalKind, m.fatalText, m.lastErr = "", "", ""
	m.addEventLocked("info", "Iniciando o bot")
	go m.run(gen, m.cfg)
}

func (m *Manager) Stop() {
	m.mu.Lock()
	m.gen++
	cmd, stdin, exited := m.cmd, m.stdin, m.exited
	m.cmd, m.stdin, m.exited = nil, nil, nil
	was := m.st.Phase != PhaseStopped && m.st.Phase != PhaseError
	m.st.Phase = PhaseStopped
	m.st.Message = ""
	m.st.ErrorKind = ""
	m.st.Bot = nil
	m.st.RunningAt = 0
	if was {
		m.addEventLocked("info", "Bot encerrado")
	}
	m.mu.Unlock()
	stopProcess(cmd, stdin, exited)
}

// stopProcess closes stdin so the bot leaves the voice channel cleanly,
// and kills it if it is still running after a moment.
func stopProcess(cmd *exec.Cmd, stdin io.WriteCloser, exited <-chan struct{}) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if stdin != nil {
		_ = stdin.Close()
	}
	select {
	case <-exited:
	case <-time.After(1500 * time.Millisecond):
		_ = cmd.Process.Kill()
	}
}

func (m *Manager) Restart() {
	m.Stop()
	m.Start()
}

// Send writes one command line to the bot's stdin.
func (m *Manager) Send(v any) error {
	m.mu.Lock()
	stdin := m.stdin
	m.mu.Unlock()
	if stdin == nil {
		return errors.New("o bot não está rodando")
	}
	b, _ := json.Marshal(v)
	_, err := stdin.Write(append(b, '\n'))
	return err
}

func (m *Manager) failLocked(kind, msg string) {
	m.cmd, m.stdin, m.exited = nil, nil, nil
	m.st.Phase = PhaseError
	m.st.ErrorKind = kind
	m.st.Message = msg
	m.st.Bot = nil
	m.st.RunningAt = 0
	m.addEventLocked("err", msg)
}

func (m *Manager) fail(gen int, kind, msg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen == m.gen {
		m.failLocked(kind, msg)
	}
}

func (m *Manager) current(gen int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return gen == m.gen
}

func (m *Manager) event(gen int, kind, text string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen == m.gen {
		m.addEventLocked(kind, text)
	}
}

func (m *Manager) run(gen int, cfg Config) {
	node, err := locateNode()
	if err != nil {
		m.fail(gen, "node", "O Node.js não foi encontrado neste computador.")
		return
	}
	version, err := nodeVersion(node)
	if err != nil {
		m.fail(gen, "node", "Não consegui rodar o Node.js: "+err.Error())
		return
	}
	m.mu.Lock()
	m.st.NodeVersion = version
	m.mu.Unlock()
	if !nodeRecentEnough(version) {
		m.fail(gen, "node-old", fmt.Sprintf("O Node.js %s é antigo demais; o bot precisa do %d.%d ou mais novo.", version, minNodeMajor, minNodeMinor))
		return
	}

	dir, err := locateBot()
	if err != nil {
		m.fail(gen, "bot", "A pasta do bot não foi encontrada ao lado do Ouvidor.exe.")
		return
	}
	m.mu.Lock()
	m.st.BotDir = dir
	m.mu.Unlock()

	if !depsInstalled(dir) {
		if !m.install(gen, node, dir) {
			return
		}
	}
	if !m.current(gen) {
		return
	}
	if !portFree(cfg.WSPort) {
		m.fail(gen, "port", fmt.Sprintf("A porta %d já está em uso. Feche o iniciar.bat (ou outra cópia do bot) ou troque a porta na engrenagem e no módulo.", cfg.WSPort))
		return
	}

	cmd := exec.Command(node, "index.js")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"OUVIDOR_IPC=1",
		"DISCORD_TOKEN="+cfg.Token,
		"GUILD_ID="+cfg.GuildID,
		"GM_DISCORD_ID="+cfg.GMID,
		"VOICE_CHANNEL_ID="+cfg.VoiceChannelID,
		"WS_PORT="+strconv.Itoa(cfg.WSPort),
		"NO_COLOR=1",
	)
	hideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		m.fail(gen, "", "Falha ao preparar o bot: "+err.Error())
		return
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	m.mu.Lock()
	if gen != m.gen {
		m.mu.Unlock()
		return
	}
	if err := cmd.Start(); err != nil {
		m.mu.Unlock()
		m.fail(gen, "", "Falha ao abrir o bot: "+err.Error())
		return
	}
	exited := make(chan struct{})
	m.cmd, m.stdin, m.exited = cmd, stdin, exited
	m.st.Message = "Conectando ao Discord…"
	m.mu.Unlock()
	attachToJob(cmd)

	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			m.handleLine(gen, sc.Text())
		}
		_, _ = io.Copy(io.Discard, pr)
	}()

	waitErr := cmd.Wait()
	close(exited)
	_ = pw.Close()
	<-scanned

	m.mu.Lock()
	defer m.mu.Unlock()
	if gen != m.gen {
		return
	}
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	switch {
	case m.fatalKind != "":
		m.failLocked(m.fatalKind, m.fatalText)
	case code == 0:
		m.cmd, m.stdin, m.exited = nil, nil, nil
		m.st.Phase = PhaseStopped
		m.st.Bot = nil
		m.addEventLocked("info", "O bot encerrou")
	default:
		// Crash: tenta de novo sozinho, com espera crescente.
		m.st.Restarts++
		wait := time.Duration(min(m.st.Restarts, 6)) * 5 * time.Second
		msg := "O bot parou inesperadamente"
		if m.lastErr != "" {
			msg += ": " + m.lastErr
		} else if waitErr != nil {
			msg += " (" + waitErr.Error() + ")"
		}
		m.addEventLocked("err", msg)
		m.addEventLocked("info", fmt.Sprintf("Reiniciando em %d s", int(wait.Seconds())))
		m.cmd, m.stdin, m.exited = nil, nil, nil
		m.st.Phase = PhaseStarting
		m.st.Message = fmt.Sprintf("Reiniciando em %d s…", int(wait.Seconds()))
		m.st.Bot = nil
		m.st.RunningAt = 0
		m.gen++
		next := m.gen
		restarts := m.st.Restarts
		time.AfterFunc(wait, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.gen != next {
				return
			}
			m.beginLocked(next)
			m.st.Restarts = restarts
		})
	}
}

type ipcLine struct {
	Ev    string `json:"ev"`
	Level string `json:"level"`
	Text  string `json:"text"`
	Kind  string `json:"kind"`
}

func (m *Manager) handleLine(gen int, line string) {
	line = strings.TrimRight(line, "\r")
	if line == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen != m.gen {
		return
	}
	if !strings.HasPrefix(line, ipcPrefix) {
		// Saída fora do protocolo: avisos do Node, stack traces.
		m.lastErr = trimLine(line)
		m.addEventLocked("warn", trimLine(line))
		return
	}
	raw := []byte(line[len(ipcPrefix):])
	var l ipcLine
	if json.Unmarshal(raw, &l) != nil {
		return
	}
	switch l.Ev {
	case "log":
		kind := l.Level
		switch kind {
		case "info", "ok", "warn", "err", "speak":
		default:
			kind = "info"
		}
		if kind == "err" {
			m.lastErr = trimLine(l.Text)
		}
		m.addEventLocked(kind, l.Text)
	case "status":
		m.st.Bot = append(json.RawMessage(nil), raw...)
		if m.st.Phase == PhaseStarting {
			m.st.Phase = PhaseRunning
			m.st.Message = ""
			m.st.RunningAt = time.Now().UnixMilli()
		}
	case "fatal":
		m.fatalKind = l.Kind
		if m.fatalKind == "" {
			m.fatalKind = "fatal"
		}
		m.fatalText = l.Text
	}
}

func trimLine(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

// install runs "npm install" with the npm that ships with Node.
func (m *Manager) install(gen int, node, dir string) bool {
	m.mu.Lock()
	if gen != m.gen {
		m.mu.Unlock()
		return false
	}
	m.st.Phase = PhaseInstalling
	m.st.Message = "Instalando as dependências do bot (só na primeira vez)…"
	m.addEventLocked("info", "Instalando dependências com o npm")
	m.mu.Unlock()

	npmCli := filepath.Join(filepath.Dir(node), "node_modules", "npm", "bin", "npm-cli.js")
	var cmd *exec.Cmd
	if _, err := os.Stat(npmCli); err == nil {
		cmd = exec.Command(node, npmCli, "install", "--omit=dev", "--no-audit", "--no-fund")
	} else if p, err := exec.LookPath("npm"); err == nil {
		cmd = exec.Command(p, "install", "--omit=dev", "--no-audit", "--no-fund")
	} else {
		m.fail(gen, "npm", "O npm não foi encontrado. Reinstale o Node.js (ele vem junto).")
		return false
	}
	cmd.Dir = dir
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if !m.current(gen) {
		return false
	}
	if err != nil {
		last := ""
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if strings.TrimSpace(l) != "" {
				last = l
			}
		}
		m.fail(gen, "npm", "Falha ao instalar as dependências: "+trimLine(last))
		return false
	}
	m.event(gen, "ok", "Dependências instaladas")
	m.mu.Lock()
	if gen == m.gen {
		m.st.Phase = PhaseStarting
		m.st.Message = "Abrindo o bot…"
	}
	m.mu.Unlock()
	return true
}

func depsInstalled(dir string) bool {
	for _, p := range []string{"discord.js", "@discordjs/voice", "ws", "dotenv"} {
		if _, err := os.Stat(filepath.Join(dir, "node_modules", filepath.FromSlash(p), "package.json")); err != nil {
			return false
		}
	}
	return true
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

func (m *Manager) watchFoundry() {
	for {
		m.mu.Lock()
		port := m.cfg.FoundryPort
		m.mu.Unlock()
		up := false
		if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 700*time.Millisecond); err == nil {
			up = true
			_ = c.Close()
		}
		m.mu.Lock()
		if m.cfg.FoundryPort == port {
			prev := m.st.FoundryUp
			m.st.FoundryUp = &up
			if prev != nil && *prev != up {
				if up {
					m.addEventLocked("ok", "Foundry online")
				} else {
					m.addEventLocked("warn", "Foundry offline")
				}
			}
		}
		m.mu.Unlock()
		time.Sleep(3 * time.Second)
	}
}

// ---- onde estão o Node e o bot ----------------------------------------------

func nodeName() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

func exeDir() string {
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		return filepath.Dir(exe)
	}
	return "."
}

// locateNode finds node: a portable copy next to the app, on PATH, or in
// the usual install folders (PATH may be stale if Node was installed after
// Windows started). It never downloads anything.
func locateNode() (string, error) {
	dir := exeDir()
	candidates := []string{
		filepath.Join(dir, "node", nodeName()),
		filepath.Join(dir, nodeName()),
	}
	if p, err := exec.LookPath("node"); err == nil {
		candidates = append(candidates, p)
	}
	if runtime.GOOS == "windows" {
		for _, env := range []string{"ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"} {
			if d := os.Getenv(env); d != "" {
				candidates = append(candidates, filepath.Join(d, "nodejs", "node.exe"))
			}
		}
		if d := os.Getenv("NVM_SYMLINK"); d != "" {
			candidates = append(candidates, filepath.Join(d, "node.exe"))
		}
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			candidates = append(candidates, filepath.Join(d, "Programs", "nodejs", "node.exe"))
		}
	}
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c, nil
		}
	}
	return "", errors.New("node não encontrado")
}

func nodeVersion(node string) (string, error) {
	cmd := exec.Command(node, "--version")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func nodeRecentEnough(v string) bool {
	parts := strings.SplitN(strings.TrimPrefix(v, "v"), ".", 3)
	if len(parts) < 2 {
		return false
	}
	major, err1 := strconv.Atoi(parts[0])
	minor, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	return major > minNodeMajor || (major == minNodeMajor && minor >= minNodeMinor)
}

// locateBot finds the bot folder: next to the app (release zip) or in the
// repository layout (app/ and bot/ side by side).
func locateBot() (string, error) {
	var candidates []string
	for _, base := range []string{exeDir(), "."} {
		candidates = append(candidates,
			filepath.Join(base, "bot"),
			filepath.Join(base, "..", "bot"),
		)
	}
	for _, c := range candidates {
		if fi, err := os.Stat(filepath.Join(c, "index.js")); err == nil && !fi.IsDir() {
			if abs, err := filepath.Abs(c); err == nil {
				return abs, nil
			}
			return c, nil
		}
	}
	return "", errors.New("pasta do bot não encontrada")
}
