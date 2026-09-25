package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Arquivos que o bot escreve em cada gravação (bot/src/recorder.js).
const (
	manifestName = "sessao.json"
	mixName      = "sessao-completa.ogg"
)

// parseIDList reads Discord IDs separated by commas, spaces or new lines.
// It returns the valid ones (without repeats) and the ones that are not IDs.
func parseIDList(s string) (ids, bad []string) {
	seen := map[string]bool{}
	for _, f := range strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\r' || r == '\t'
	}) {
		switch {
		case !snowflake.MatchString(f):
			bad = append(bad, f)
		case !seen[f]:
			seen[f] = true
			ids = append(ids, f)
		}
	}
	return ids, bad
}

// Recording is one session folder as the UI lists it.
type Recording struct {
	Name      string  `json:"name"`
	Dir       string  `json:"dir"`
	StartedAt string  `json:"startedAt"`
	Duration  float64 `json:"duration"`
	Tracks    int     `json:"tracks"`
	Markers   int     `json:"markers"`
	Bytes     int64   `json:"bytes"`
	Ended     bool    `json:"ended"`
	HasMix    bool    `json:"hasMix"`
	MixStatus string  `json:"mixStatus"`
}

type manifest struct {
	StartedAt string            `json:"startedAt"`
	EndedAt   *string           `json:"endedAt"`
	Duration  float64           `json:"duration"`
	Tracks    []json.RawMessage `json:"tracks"`
	Markers   []json.RawMessage `json:"markers"`
	Mix       *struct {
		Status string `json:"status"`
	} `json:"mix"`
}

// listRecordings returns the newest session folders in dir (at most limit).
func listRecordings(dir string, limit int) []Recording {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []Recording{}
	}
	out := []Recording{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		b, err := os.ReadFile(filepath.Join(sub, manifestName))
		if err != nil {
			continue
		}
		var m manifest
		if json.Unmarshal(b, &m) != nil {
			continue
		}
		r := Recording{
			Name: e.Name(), Dir: sub, StartedAt: m.StartedAt, Duration: m.Duration,
			Tracks: len(m.Tracks), Markers: len(m.Markers), Ended: m.EndedAt != nil,
		}
		if m.Mix != nil {
			r.MixStatus = m.Mix.Status
		}
		if files, err := os.ReadDir(sub); err == nil {
			for _, f := range files {
				if info, err := f.Info(); err == nil && !f.IsDir() {
					r.Bytes += info.Size()
				}
				if f.Name() == mixName {
					r.HasMix = true
				}
			}
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].StartedAt != out[j].StartedAt {
			return out[i].StartedAt > out[j].StartedAt
		}
		return out[i].Name > out[j].Name
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// recordingDir checks that path is a session folder inside the recordings
// folder, so the UI can only open or mix those.
func recordingDir(root, path string) (string, error) {
	if root == "" || path == "" {
		return "", errors.New("gravação não encontrada")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(rootAbs, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("essa pasta não está dentro da pasta das gravações")
	}
	if _, err := os.Stat(filepath.Join(abs, manifestName)); err != nil {
		return "", fmt.Errorf("essa pasta não tem o %s", manifestName)
	}
	return abs, nil
}
