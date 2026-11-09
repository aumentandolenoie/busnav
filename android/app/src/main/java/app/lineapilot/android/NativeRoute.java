package app.lineapilot.android;
import org.json.*;
import java.util.*;

final class NativeRoute {
    static final class Turn {double at;String text,side,kind;boolean verified;}
    static final class Camera {
        final double at;
        final String title;
        Camera(double at, String kind) {
            this.at = at;
            title = kind.equals("redLight") ? "Controllo semaforico" : "Autovelox fisso";
        }
    }
    private final List<double[]> speedLimits = new ArrayList<>();
    final List<Camera> cameras = new ArrayList<>();
    final double[][] points,stopCoordinates,ranges;
    final double[] offsets;final String[] stops;final List<Turn> turns=new ArrayList<>();final String name;
    NativeRoute(JSONObject raw)throws JSONException{
        points=coordinates(raw.getJSONArray("points"));GPXTracker tracker=new GPXTracker(points);name=raw.optString("name","GPX ufficiale");
        JSONArray ss=raw.optJSONArray("stops"),ds=raw.optJSONArray("offsets");int n=ss==null?0:ss.length();stops=new String[n];offsets=new double[n];
        if(n>1000||ds==null||ds.length()!=n)throw new IllegalArgumentException("Fermate non valide");
        for(int i=0;i<n;i++){stops[i]=ss.getString(i);offsets[i]=ds.getDouble(i);if(!Double.isFinite(offsets[i])||offsets[i]<0||offsets[i]>tracker.total()+1||(i>0&&offsets[i]<offsets[i-1]))throw new IllegalArgumentException("Ordine fermate non valido");}
        JSONArray sc=raw.optJSONArray("stopCoordinates");stopCoordinates=sc==null?new double[0][2]:coordinates(sc);
        JSONObject c=raw.optJSONObject("coverage");ranges=c==null?new double[0][2]:coordinates(c.optJSONArray("ranges"));
        double end=-1;for(double[] r:ranges){if(!Double.isFinite(r[0])||!Double.isFinite(r[1])||r[0]<0||r[1]<=r[0]||r[0]<end||r[1]>tracker.total()+1)throw new IllegalArgumentException("Copertura non valida");end=r[1];}
        JSONArray ts=raw.optJSONArray("turns");if(ts!=null)for(int i=0;i<ts.length();i++){
            JSONObject t=ts.getJSONObject(i);Turn turn=new Turn();turn.at=t.getDouble("at");turn.text=t.optString("text","");turn.side=t.optString("side","");turn.kind=t.optString("kind","turn");turn.verified=t.optBoolean("verifiedRoad",false);
            if(turn.verified&&Double.isFinite(turn.at)&&turn.at>=0&&turn.at<=tracker.total()&&!turn.text.isEmpty()&&turn.text.length()<1500&&covered(turn.at,turn.at))turns.add(turn);
        }
        JSONArray limits = raw.optJSONArray("speedLimits");
        if (limits != null) for (int i = 0; i < limits.length(); i++) {
            JSONArray row = limits.optJSONArray(i);
            if (row == null || row.length() != 3) continue;
            double from = row.optDouble(0), to = row.optDouble(1), limit = row.optDouble(2);
            if (from >= 0 && to > from && to <= tracker.total() + 1 &&
                    limit >= 5 && limit <= 130 && limit == Math.rint(limit)) {
                speedLimits.add(new double[]{from, to, limit});
            }
        }
        JSONArray camerasJson = raw.optJSONArray("roadCameras");
        if (camerasJson != null) for (int i = 0; i < camerasJson.length(); i++) {
            JSONObject item = camerasJson.optJSONObject(i);
            if (item == null) continue;
            double at = item.optDouble("at");
            String kind = item.optString("kind");
            if (at >= 0 && at <= tracker.total() && (kind.equals("speed") || kind.equals("redLight"))) {
                cameras.add(new Camera(at, kind));
            }
        }
        cameras.sort(Comparator.comparingDouble(camera -> camera.at));
        turns.sort(Comparator.comparingDouble(t->t.at));
    }
    static double[][] coordinates(JSONArray a)throws JSONException{if(a==null)return new double[0][2];double[][] out=new double[a.length()][2];for(int i=0;i<a.length();i++){JSONArray p=a.getJSONArray(i);if(p.length()!=2)throw new IllegalArgumentException("Coppia di coordinate non valida");out[i][0]=p.getDouble(0);out[i][1]=p.getDouble(1);}return out;}
    boolean covered(double along,double maneuver){return GuidanceCoverage.contains(ranges,along,maneuver);}
    Turn nextTurn(double along){for(Turn t:turns)if(t.at>along-12&&covered(along,t.at))return t;return null;}
    int speedLimit(double along) {
        if (!covered(along, along)) return 0;
        int result = 0;
        for (double[] segment : speedLimits) {
            if (segment[0] <= along && along < segment[1]) {
                int value = (int) segment[2];
                if (result != 0 && result != value) return 0;
                result = value;
            }
        }
        return result;
    }

    int nextCamera(double along, double distance, Set<Integer> excluded) {
        for (int index = 0; index < cameras.size(); index++) {
            Camera camera = cameras.get(index);
            if (camera.at > along + distance) break;
            if (!excluded.contains(index) && camera.at > along && covered(along, camera.at)) return index;
        }
        return -1;
    }

    static final class Continuation {
        final int index;
        final boolean isStop;
        final String text;

        Continuation(int index, boolean isStop, String text) {
            this.index = index;
            this.isStop = isStop;
            this.text = text;
        }
    }

    int upcomingStop(double progress, int index) {
        while (index < offsets.length && offsets[index] < progress) index++;
        return index;
    }

    Continuation continuation(int index, double progress, int stopIndex) {
        Turn first = turns.get(index);
        int stop = upcomingStop(progress, stopIndex);
        double stopAt = stop < offsets.length ? offsets[stop] : Double.POSITIVE_INFINITY;
        if (first.at < progress || stopAt <= first.at) return null;
        int nextIndex = index + 1;
        Turn next = nextIndex < turns.size() ? turns.get(nextIndex) : null;
        double nextAt = next == null ? Double.POSITIVE_INFINITY : next.at;
        double secondAt = Math.min(stopAt, nextAt);
        double gap = secondAt - first.at;
        if (gap < 5 || gap > 80 || !covered(progress, secondAt)) return null;
        if (stopAt < nextAt) return new Continuation(stop, true, "prossima fermata: " + stops[stop]);
        if (next == null || nextAt >= stopAt) return null;
        return new Continuation(nextIndex, false, next.text);
    }

    static String voiceMessage(String first, Double distance, Continuation continuation) {
        String clause = stripPunctuation(first);
        String message = distance == null ? clause : "Tra circa " + Math.round(distance) + " metri, " + lowerInitial(clause);
        if (continuation != null) message += ", poi " + lowerInitial(stripPunctuation(continuation.text));
        return message + ".";
    }

    private static String stripPunctuation(String text) {
        return text.trim().replaceFirst("[.!?]+$", "");
    }

    private static String lowerInitial(String text) {
        return text.isEmpty() ? text : text.substring(0, 1).toLowerCase(Locale.ITALIAN) + text.substring(1);
    }

}
