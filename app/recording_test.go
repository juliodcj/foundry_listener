package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseIDList(t *testing.T) {
	ids, bad := parseIDList("123456789012345678, 223456789012345678\n123456789012345678;abc")
	if want := []string{"123456789012345678", "223456789012345678"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("ids = %v, want %v", ids, want)
	}
	if want := []string{"abc"}; !reflect.DeepEqual(bad, want) {
		t.Errorf("bad = %v, want %v", bad, want)
	}
}

func TestNormalizeRecordDefaults(t *testing.T) {
	c := Config{RecordExclude: []string{"x", "123456789012345678"}}
	c.normalize()
	if c.RecordDir == "" {
		t.Error("record dir should default to a folder")
	}
	if !reflect.DeepEqual(c.RecordExclude, []string{"123456789012345678"}) {
		t.Errorf("exclude = %v", c.RecordExclude)
	}
	if !defaultConfig().RecordNotify {
		t.Error("the recording notice should be on by default")
	}
}

func writeSession(t *testing.T, root, name, manifest string, files ...string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, manifestName), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("OggS"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestListRecordings(t *testing.T) {
	root := t.TempDir()
	writeSession(t, root, "2026-09-20_20-00_Taverna",
		`{"startedAt":"2026-09-20T23:00:00.000Z","endedAt":"2026-09-21T02:00:00.000Z","duration":10800,
		  "tracks":[{"file":"a.ogg"},{"file":"b.ogg"}],"markers":[{"at":1,"label":"x"}],
		  "mix":{"file":"2026-09-20_20-00_sessao-completa.ogg","status":"ok"}}`,
		"a.ogg", "b.ogg", "2026-09-20_20-00_sessao-completa.ogg")
	writeSession(t, root, "2026-09-24_21-30_Taverna",
		`{"startedAt":"2026-09-25T00:30:00.000Z","endedAt":null,"duration":60,"tracks":[],"markers":[],"mix":null}`)
	// Gravação de antes da data nos nomes: o mix se chamava sessao-completa.ogg.
	writeSession(t, root, "2026-09-10_20-00_Taverna",
		`{"startedAt":"2026-09-10T23:00:00.000Z","endedAt":"2026-09-11T00:00:00.000Z","duration":3600,
		  "tracks":[{"file":"a.ogg"}],"markers":[],"mix":{"status":"ok"}}`,
		"a.ogg", oldMixName)
	_ = os.MkdirAll(filepath.Join(root, "outra-pasta"), 0o755)

	got := listRecordings(root, 5)
	if len(got) != 3 {
		t.Fatalf("got %d recordings: %+v", len(got), got)
	}
	if got[0].Name != "2026-09-24_21-30_Taverna" || got[0].Ended {
		t.Errorf("newest first, still running: %+v", got[0])
	}
	old := got[1]
	if !old.Ended || !old.HasMix || old.MixStatus != "ok" || old.Tracks != 2 || old.Markers != 1 || old.Duration != 10800 {
		t.Errorf("old session: %+v", old)
	}
	if old.Bytes <= 0 {
		t.Errorf("bytes not counted: %+v", old)
	}
	if !got[2].HasMix {
		t.Errorf("old mix name not found: %+v", got[2])
	}
	if got := listRecordings(filepath.Join(root, "nao-existe"), 5); got == nil || len(got) != 0 {
		t.Errorf("missing folder should give an empty list, got %v", got)
	}
}

func TestRecordingDir(t *testing.T) {
	root := t.TempDir()
	session := writeSession(t, root, "sessao", `{}`)
	if got, err := recordingDir(root, session); err != nil || got != session {
		t.Errorf("session inside root: %q %v", got, err)
	}
	for _, bad := range []string{root, filepath.Join(root, ".."), filepath.Join(root, "nao-existe"), ""} {
		if _, err := recordingDir(root, bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}
