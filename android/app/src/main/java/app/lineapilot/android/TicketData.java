package app.lineapilot.android;
import org.json.*;
import java.util.*;

/** On-board ticket calculator: Busitalia Padova polimetriche (fares/polimetriche-padova.json).
 *  The web layer sends the data with the route; the rules match tickets.js and iOS TicketData.
 *  fares[i][j] (j <= i) is a code such as "C3", "TU2" or "" and labels.get(code) the text to show. */
final class TicketData {
    /** Boarding is suggested only when a fare node is this close to the bus. */
    static final double NEAREST_LIMIT = 6000;

    static final class Line {
        final String code, title;
        final String[] names;
        final double[][] positions; // null entry when the node has no known position
        final String[][] fares;
        Line(String code, String title, String[] names, double[][] positions, String[][] fares) {
            this.code = code; this.title = title; this.names = names; this.positions = positions; this.fares = fares;
        }
        String label() { return code + " · " + title; }
    }

    final Map<String, String> labels;
    final List<Line> lines;
    final int[] suggested;

    TicketData(Map<String, String> labels, List<Line> lines, int[] suggested) {
        this.labels = labels; this.lines = lines;
        int[] valid = new int[suggested.length]; int n = 0;
        for (int i : suggested) if (i >= 0 && i < lines.size()) valid[n++] = i;
        this.suggested = Arrays.copyOf(valid, n);
    }

    /** Null when the payload has no usable ticket data: the calculator is then hidden. */
    static TicketData parse(JSONObject raw) {
        if (raw == null) return null;
        try {
            Map<String, String> labels = new HashMap<>();
            JSONObject l = raw.getJSONObject("labels");
            for (Iterator<String> keys = l.keys(); keys.hasNext(); ) { String k = keys.next(); labels.put(k, l.getString(k)); }
            JSONArray ls = raw.getJSONArray("lines");
            List<Line> lines = new ArrayList<>();
            for (int i = 0; i < ls.length(); i++) {
                JSONObject o = ls.getJSONObject(i);
                JSONArray st = o.getJSONArray("stops"), fs = o.getJSONArray("fares");
                int n = st.length();
                if (fs.length() != n) throw new JSONException("fares");
                String[] names = new String[n]; double[][] pos = new double[n][]; String[][] fares = new String[n][];
                for (int s = 0; s < n; s++) {
                    JSONArray stop = st.getJSONArray(s);
                    names[s] = stop.getString(0);
                    if (stop.length() >= 3) pos[s] = new double[]{stop.getDouble(1), stop.getDouble(2)};
                    JSONArray row = fs.getJSONArray(s);
                    fares[s] = new String[row.length()];
                    for (int j = 0; j < row.length(); j++) fares[s][j] = row.getString(j);
                }
                lines.add(new Line(o.getString("code"), o.optString("title", ""), names, pos, fares));
            }
            JSONArray sg = raw.optJSONArray("suggested");
            int[] suggested = new int[sg == null ? 0 : sg.length()];
            for (int i = 0; i < suggested.length; i++) suggested[i] = sg.getInt(i);
            return lines.isEmpty() ? null : new TicketData(labels, lines, suggested);
        } catch (JSONException e) {
            return null; // bad ticket data must never block navigation
        }
    }

    /** Suggested lines first, then all the others. */
    List<Integer> orderedLines() {
        List<Integer> out = new ArrayList<>();
        for (int i : suggested) out.add(i);
        for (int i = 0; i < lines.size(); i++) if (!out.contains(i)) out.add(i);
        return out;
    }

    /** Fare code between two stops of a line, in either order; null if out of range. */
    String code(int line, int from, int to) {
        if (line < 0 || line >= lines.size()) return null;
        Line l = lines.get(line);
        if (from < 0 || to < 0 || from >= l.names.length || to >= l.names.length) return null;
        String[] row = l.fares[Math.max(from, to)];
        int j = Math.min(from, to);
        return j < row.length ? row[j] : null;
    }

    /** "Classe 3 = € 4,00 a bordo", or the "not in the polimetrica" text. */
    String fareText(int line, int from, int to) {
        String code = code(line, from, to);
        if (code == null) return null;
        String text = labels.get(code);
        return text != null ? text : labels.get("");
    }

    /** Nearest fare node with a known position within {@code limit} metres, or -1. */
    int nearestStop(int line, double lat, double lon, double limit) {
        if (line < 0 || line >= lines.size() || !Double.isFinite(lat) || !Double.isFinite(lon)) return -1;
        double[][] pos = lines.get(line).positions;
        int best = -1; double bestDistance = Double.POSITIVE_INFINITY;
        for (int i = 0; i < pos.length; i++) {
            if (pos[i] == null) continue;
            double d = metres(lat, lon, pos[i][0], pos[i][1]);
            if (d < bestDistance) { best = i; bestDistance = d; }
        }
        return bestDistance <= limit ? best : -1;
    }
    int nearestStop(int line, double lat, double lon) { return nearestStop(line, lat, lon, NEAREST_LIMIT); }

    static double metres(double lat1, double lon1, double lat2, double lon2) {
        double y = (lat2 - lat1) * 111320, x = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
        return Math.hypot(x, y);
    }
}
