package app.lineapilot.android;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.*;
import android.widget.*;
import java.util.*;

/** Small sheet over the driving screen: Linea, Salita, Discesa and "Classe X = € Y a bordo".
 *  Only a dialog window: NavigationSession, GPS and voice keep running underneath. */
final class TicketDialog {
    private final TicketData data;
    private final AlertDialog dialog;
    private final Spinner line, from, to;
    private final TextView result, fareNote;
    private final List<Integer> order;
    private int lineIndex, fromIndex = -1, toIndex = -1;
    private double[] fix;
    private boolean updating;

    TicketDialog(Context c, TicketData data) {
        this.data = data;
        order = data.orderedLines();
        lineIndex = data.suggested.length > 0 ? data.suggested[0] : -1;
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(c, 20), dp(c, 8), dp(c, 20), dp(c, 4));
        line = spinner(c, "ticket-line"); from = spinner(c, "ticket-from"); to = spinner(c, "ticket-to");
        box.addView(row(c, "Linea", line)); box.addView(row(c, "Salita", from)); box.addView(row(c, "Discesa", to));
        result = new TextView(c);
        result.setTag("ticket-result");
        result.setPadding(0, dp(c, 10), 0, dp(c, 4));
        box.addView(result);
        fareNote = new TextView(c);
        fareNote.setTag("ticket-fare-note");
        fareNote.setTextSize(14); fareNote.setTextColor(Color.BLACK);
        fareNote.setPadding(dp(c, 10), dp(c, 8), dp(c, 10), dp(c, 8));
        android.graphics.drawable.GradientDrawable tint = new android.graphics.drawable.GradientDrawable();
        tint.setColor(Color.argb(26, 11, 110, 79)); tint.setCornerRadius(dp(c, 12));
        fareNote.setBackground(tint); fareNote.setVisibility(View.GONE);
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(-1, -2); np.setMargins(0, 0, 0, dp(c, 6));
        box.addView(fareNote, np);
        TextView note = new TextView(c);
        note.setText("Prezzi a bordo, corsa semplice · polimetriche Busitalia 10/2024");
        note.setTextSize(11); note.setTextColor(Color.GRAY);
        box.addView(note);
        dialog = new AlertDialog.Builder(c).setTitle("Biglietto a bordo").setView(box)
                .setPositiveButton("Chiudi", null).create();
        dialog.setCanceledOnTouchOutside(true);
        Window w = dialog.getWindow();
        if (w != null) { w.setDimAmount(0.15f); w.setGravity(Gravity.BOTTOM); }
        line.setOnItemSelectedListener(listener(position -> {
            int chosen = lineAt(position);
            if (chosen == lineIndex) return;
            lineIndex = chosen; fromIndex = -1; toIndex = -1;
            if (fix != null) fromIndex = data.nearestStop(lineIndex, fix[0], fix[1]);
            render();
        }));
        // Adapters are rebuilt on every render and Android re-reports the selection:
        // only a real change re-renders, so this never loops.
        from.setOnItemSelectedListener(listener(position -> { int v = stopAt(position, fromIndex); if (v != fromIndex) { fromIndex = v; render(); } }));
        to.setOnItemSelectedListener(listener(position -> { int v = stopAt(position, toIndex); if (v != toIndex) { toIndex = v; render(); } }));
        render();
    }

    void show() { dialog.show(); }
    void dismiss() { dialog.dismiss(); }
    boolean isShowing() { return dialog.isShowing(); }

    /** The boarding stop follows the bus each time the sheet is opened. */
    void suggestBoarding(double lat, double lon) {
        fix = new double[]{lat, lon};
        int near = data.nearestStop(lineIndex, lat, lon);
        if (near >= 0) { fromIndex = near; if (toIndex == near) toIndex = -1; }
        render();
    }

    // Spinner positions: optional placeholder first, then the real items.
    private boolean linePlaceholder() { return lineIndex < 0; }
    private int lineAt(int position) {
        int p = position - (linePlaceholder() ? 1 : 0);
        return p >= 0 && p < order.size() ? order.get(p) : -1;
    }
    private int stopAt(int position, int current) {
        int p = position - (current < 0 ? 1 : 0);
        return p >= 0 && lineIndex >= 0 && p < data.lines.get(lineIndex).names.length ? p : current;
    }

    private void render() {
        updating = true;
        Context c = dialog.getContext();
        List<String> lines = new ArrayList<>();
        if (linePlaceholder()) lines.add("Scegli la linea");
        for (int i = 0; i < order.size(); i++) {
            int index = order.get(i);
            String prefix = i < data.suggested.length ? "● " : "";
            lines.add(prefix + data.lines.get(index).label());
        }
        fill(c, line, lines, linePlaceholder() ? 0 : order.indexOf(lineIndex));
        TicketData.Line l = lineIndex >= 0 ? data.lines.get(lineIndex) : null;
        for (Spinner s : new Spinner[]{from, to}) {
            int current = s == from ? fromIndex : toIndex;
            List<String> items = new ArrayList<>();
            if (l == null) { items.add("—"); fill(c, s, items, 0); s.setEnabled(false); continue; }
            s.setEnabled(true);
            if (current < 0) items.add(s == from ? "Scegli la salita" : "Scegli la discesa");
            for (int i = 0; i < l.names.length; i++) items.add((i + 1) + " · " + l.names[i]);
            fill(c, s, items, current < 0 ? 0 : current);
        }
        String text, howTo = ""; boolean priced = false;
        if (l == null) text = "Scegli la linea della polimetrica";
        else if (fromIndex < 0) text = "Scegli la salita";
        else if (toIndex < 0) text = "Scegli la discesa";
        else {
            String code = data.code(lineIndex, fromIndex, toIndex);
            text = data.fareText(lineIndex, fromIndex, toIndex);
            if (text == null) text = data.labels.get("");
            priced = code != null && !code.isEmpty();
            howTo = data.fareNote(lineIndex, fromIndex, toIndex);
        }
        fareNote.setText(howTo);
        fareNote.setVisibility(howTo.isEmpty() ? View.GONE : View.VISIBLE);
        result.setText(text);
        result.setTextSize(priced ? 22 : 16);
        result.setTypeface(Typeface.DEFAULT, priced ? Typeface.BOLD : Typeface.NORMAL);
        result.setTextColor(priced ? Color.rgb(11, 110, 79) : Color.DKGRAY);
        result.setContentDescription(text);
        updating = false;
    }

    private void fill(Context c, Spinner s, List<String> items, int selection) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(c, android.R.layout.simple_spinner_item, items);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        s.setAdapter(adapter);
        s.setSelection(Math.max(0, Math.min(selection, items.size() - 1)), false);
    }

    private interface Pick { void at(int position); }
    private AdapterView.OnItemSelectedListener listener(Pick pick) {
        return new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (!updating) parent.post(() -> pick.at(position));
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        };
    }

    private Spinner spinner(Context c, String tag) {
        Spinner s = new Spinner(c, Spinner.MODE_DIALOG);
        s.setTag(tag);
        s.setMinimumHeight(dp(c, 48));
        return s;
    }
    private View row(Context c, String name, Spinner s) {
        LinearLayout r = new LinearLayout(c);
        r.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = new TextView(c);
        label.setText(name); label.setTextSize(13); label.setTypeface(Typeface.DEFAULT, Typeface.BOLD); label.setTextColor(Color.GRAY);
        r.addView(label, new LinearLayout.LayoutParams(dp(c, 64), -2));
        r.addView(s, new LinearLayout.LayoutParams(0, dp(c, 52), 1));
        return r;
    }
    private static int dp(Context c, float v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }
}
