package app.lineapilot.android;

/**
 * One rounding rule for every distance on screen and in the voice, identical on
 * web (app.js), iOS and Android: from 100 m in steps of 50 m, from 50 to 100 m
 * in steps of 10 m, below 50 m in steps of 5 m; from 1 km in tenths of a km.
 */
final class DistanceText {
    private DistanceText() { }

    static int rounded(double metres) {
        double m = Double.isFinite(metres) ? Math.max(0, metres) : 0;
        double step = m >= 100 ? 50 : m >= 50 ? 10 : 5;
        return (int) (Math.round(m / step) * step);
    }

    private static String kilometres(double metres) {
        long tenths = Math.round(Math.max(0, metres) / 100);
        return tenths % 10 == 0 ? String.valueOf(tenths / 10) : (tenths / 10) + "," + (tenths % 10);
    }

    /** "150 m", "85 m", "35 m", "1,2 km". */
    static String display(double metres) {
        int value = rounded(metres);
        return value < 1000 ? value + " m" : kilometres(metres) + " km";
    }

    /** "150 metri", "1,2 chilometri", "1 chilometro". */
    static String spoken(double metres) {
        int value = rounded(metres);
        if (value < 1000) return value + " metri";
        String km = kilometres(metres);
        return km + ("1".equals(km) ? " chilometro" : " chilometri");
    }
}
