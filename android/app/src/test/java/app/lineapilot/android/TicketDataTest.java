package app.lineapilot.android;
import org.json.*;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import static org.junit.Assert.*;

// Same polimetriche and the same cases as tickets.js and iOS (tests/fixtures/ticket-cases.json).
public class TicketDataTest {
    private static String read(String name) throws Exception {
        for (String prefix : new String[]{"../", "../../", ""}) {
            Path p = Paths.get(prefix + name);
            if (Files.exists(p)) return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
        }
        throw new java.io.FileNotFoundException(name);
    }
    private static int line(TicketData d, String code) {
        for (int i = 0; i < d.lines.size(); i++) if (d.lines.get(i).code.equals(code)) return i;
        return -1;
    }
    private static int stop(TicketData d, int line, String name) {
        String[] names = d.lines.get(line).names;
        for (int i = 0; i < names.length; i++) if (names[i].equals(name)) return i;
        return -1;
    }

    @Test public void sharedCases() throws Exception {
        JSONObject raw = new JSONObject(read("fares/polimetriche-padova.json"));
        raw.put("suggested", new JSONArray().put(0).put(99));
        TicketData d = TicketData.parse(raw);
        assertNotNull(d);
        assertEquals(62, d.lines.size());
        assertArrayEquals(new int[]{0}, d.suggested);
        assertEquals(Integer.valueOf(0), d.orderedLines().get(0));
        assertEquals(62, d.orderedLines().size());
        JSONObject cases = new JSONObject(read("tests/fixtures/ticket-cases.json"));
        JSONArray fares = cases.getJSONArray("fares");
        for (int i = 0; i < fares.length(); i++) {
            JSONObject c = fares.getJSONObject(i);
            int l = line(d, c.getString("line")), a = stop(d, l, c.getString("from")), b = stop(d, l, c.getString("to"));
            assertTrue(c.toString(), l >= 0 && a >= 0 && b >= 0);
            assertEquals(c.toString(), c.getString("text"), d.fareText(l, a, b));
        }
        assertEquals(11, fares.length());
        JSONArray nearest = cases.getJSONArray("nearest");
        for (int i = 0; i < nearest.length(); i++) {
            JSONObject c = nearest.getJSONObject(i);
            int l = line(d, c.getString("line"));
            int n = d.nearestStop(l, c.getDouble("lat"), c.getDouble("lng"));
            assertEquals(c.toString(), c.isNull("stop") ? null : c.getString("stop"), n < 0 ? null : d.lines.get(l).names[n]);
        }
        JSONArray suggested = cases.getJSONArray("suggested");
        for (int i = 0; i < suggested.length(); i++) {
            JSONObject c = suggested.getJSONObject(i), r = c.getJSONObject("route");
            int[] got = TicketData.suggestedLines(d.lines, r.optString("category", ""), r.optString("line", ""), r.optString("name", ""));
            JSONArray want = c.getJSONArray("lines");
            assertEquals(c.toString(), want.length(), got.length);
            for (int k = 0; k < got.length; k++) assertEquals(c.toString(), want.getString(k), d.lines.get(got[k]).code);
        }
        JSONObject plain = new JSONObject(read("fares/polimetriche-padova.json"));
        TicketData resolved = TicketData.resolve(null, plain, new JSONObject("{\"category\":\"Extraurbano\",\"line\":\"1\",\"name\":\"239 | Padova - Cavarzere\"}"));
        assertEquals("E001", resolved.lines.get(resolved.suggested[0]).code);
        assertNull(d.fareText(0, -1, 2));
        assertNull(d.fareText(0, 0, 999));
        assertNull(d.fareText(-1, 0, 1));
    }

    @Test public void badDataHidesCalculatorWithoutBreakingTheRoute() throws Exception {
        assertNull(TicketData.parse(null));
        assertNull(TicketData.parse(new JSONObject("{\"labels\":{},\"lines\":[{\"code\":\"X\",\"stops\":[[\"A\"]],\"fares\":[]}]}")));
        assertNull(TicketData.parse(new JSONObject("{\"labels\":{},\"lines\":[]}")));
    }
}
