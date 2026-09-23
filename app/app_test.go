package main

import (
	"bufio"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseEnv(t *testing.T) {
	env := parseEnv(bufio.NewScanner(strings.NewReader(`
# comentário
DISCORD_TOKEN="abc.def"
GUILD_ID=123456789012345678
export GM_DISCORD_ID = '223456789012345678'
VOICE_CHANNEL_ID=
WS_PORT=9000
`)))
	want := map[string]string{
		"DISCORD_TOKEN": "abc.def", "GUILD_ID": "123456789012345678",
		"GM_DISCORD_ID": "223456789012345678", "VOICE_CHANNEL_ID": "", "WS_PORT": "9000",
	}
	for k, v := range want {
		if env[k] != v {
			t.Errorf("%s = %q, want %q", k, env[k], v)
		}
	}
}

func TestValidate(t *testing.T) {
	c := defaultConfig()
	if c.Validate() == nil {
		t.Fatal("empty config should not validate")
	}
	c.Token, c.GuildID, c.GMID = "x", "123456789012345678", "223456789012345678"
	if err := c.Validate(); err != nil {
		t.Fatalf("valid config: %v", err)
	}
	c.VoiceChannelID = "abc"
	if c.Validate() == nil {
		t.Fatal("bad channel id should fail")
	}
}

func TestNormalizePorts(t *testing.T) {
	c := Config{WSPort: 0, FoundryPort: 70000}
	c.normalize()
	if c.WSPort != 8770 || c.FoundryPort != 30000 {
		t.Fatalf("got %d %d", c.WSPort, c.FoundryPort)
	}
}

func TestNodeRecentEnough(t *testing.T) {
	cases := map[string]bool{
		"v22.12.0": true, "v22.22.2": true, "v24.1.0": true,
		"v22.11.9": false, "v20.18.0": false, "garbage": false,
	}
	for v, want := range cases {
		if got := nodeRecentEnough(v); got != want {
			t.Errorf("%s: got %v want %v", v, got, want)
		}
	}
}

func newTestManager() *Manager {
	m := &Manager{}
	m.gen = 1
	m.st.Phase = PhaseStarting
	return m
}

func TestHandleLineStatusAndLogs(t *testing.T) {
	m := newTestManager()
	m.handleLine(1, `@@OUVIDOR {"ev":"log","level":"ok","text":"Conectado"}`)
	m.handleLine(1, `@@OUVIDOR {"ev":"status","discord":"online","members":[]}`)
	m.handleLine(1, "(node:123) Warning: algo")
	m.handleLine(2, `@@OUVIDOR {"ev":"log","level":"ok","text":"de outra geração"}`)
	s := m.Snapshot()
	if s.Phase != PhaseRunning || s.RunningAt == 0 {
		t.Fatalf("phase %s runningAt %d", s.Phase, s.RunningAt)
	}
	var bot map[string]any
	if err := json.Unmarshal(s.Bot, &bot); err != nil || bot["discord"] != "online" {
		t.Fatalf("bot status not kept: %s", s.Bot)
	}
	if len(s.Events) != 2 || s.Events[0].Kind != "ok" || s.Events[1].Kind != "warn" {
		t.Fatalf("events: %+v", s.Events)
	}
}

func TestHandleLineFatal(t *testing.T) {
	m := newTestManager()
	m.handleLine(1, `@@OUVIDOR {"ev":"fatal","kind":"token","text":"token ruim"}`)
	if m.fatalKind != "token" || m.fatalText != "token ruim" {
		t.Fatalf("fatal not recorded: %q %q", m.fatalKind, m.fatalText)
	}
}
