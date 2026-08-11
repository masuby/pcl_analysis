package handlers

import "testing"

// Renumbering must survive multi-digit placeholders. Doing it with successive
// ReplaceAll calls silently corrupts them ($12 becomes $32 when $1 is rewritten
// to $3), which would bind the wrong argument to the wrong filter.
func TestShiftPlaceholders(t *testing.T) {
	cases := []struct {
		in     string
		offset int
		want   string
	}{
		{"a = $1", 2, "a = $3"},
		{"a = $1 AND b = $2", 2, "a = $3 AND b = $4"},
		{"a = $1 AND b = $12", 2, "a = $3 AND b = $14"},
		{"x IN ($9,$10,$11)", 1, "x IN ($10,$11,$12)"},
		{"a = $1", 0, "a = $1"},
		{"no placeholders", 5, "no placeholders"},
		{"lower(n) LIKE '%' || $3 || '%' OR p LIKE '%' || $3 || '%'", 4,
			"lower(n) LIKE '%' || $7 || '%' OR p LIKE '%' || $7 || '%'"},
	}
	for _, c := range cases {
		if got := shiftPlaceholders(c.in, c.offset); got != c.want {
			t.Errorf("shiftPlaceholders(%q, %d) = %q, want %q", c.in, c.offset, got, c.want)
		}
	}
}

func TestFirstNameAndPlural(t *testing.T) {
	if firstName("Asina Mbura") != "Asina" {
		t.Error("firstName should take the first token")
	}
	if firstName("") != "" {
		t.Error("firstName should tolerate empty")
	}
	if plural(1) != "" || plural(0) != "s" || plural(2) != "s" {
		t.Error("plural wrong")
	}
}

func TestHTMLEscape(t *testing.T) {
	got := htmlEscape(`Tom & "Jerry" <script>`)
	want := `Tom &amp; &quot;Jerry&quot; &lt;script&gt;`
	if got != want {
		t.Errorf("htmlEscape = %q, want %q", got, want)
	}
}
