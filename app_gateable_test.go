package main

import "testing"

// ListGateableTools feeds the per-agent tool-authorization checklist, so it must
// carry names and descriptions and exclude the always-resident meta-tools.
func TestListGateableToolsExposesToolsWithoutMeta(t *testing.T) {
	got := (&App{}).ListGateableTools()

	if len(got) == 0 {
		t.Fatal("ListGateableTools() returned nothing")
	}
	var sawWrite bool
	for _, tl := range got {
		if tl.Name == "" || tl.Description == "" {
			t.Errorf("gateable tool missing name/description: %+v", tl)
		}
		if tl.Name == "write_file" {
			sawWrite = true
		}
		if tl.Name == "call_tool" || tl.Name == "load_capabilities" {
			t.Errorf("leaked meta-tool %q", tl.Name)
		}
	}
	if !sawWrite {
		t.Error("missing write_file")
	}
}
