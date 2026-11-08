package app.lineapilot.android;
import org.json.*;
import java.util.*;

final class NativeRoute {
    static final class Turn {double at;String text,side,kind;boolean verified;}
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
        turns.sort(Comparator.comparingDouble(t->t.at));
    }
    static double[][] coordinates(JSONArray a)throws JSONException{if(a==null)return new double[0][2];double[][] out=new double[a.length()][2];for(int i=0;i<a.length();i++){JSONArray p=a.getJSONArray(i);if(p.length()!=2)throw new IllegalArgumentException("Coppia di coordinate non valida");out[i][0]=p.getDouble(0);out[i][1]=p.getDouble(1);}return out;}
    boolean covered(double along,double maneuver){return GuidanceCoverage.contains(ranges,along,maneuver);}
    Turn nextTurn(double along){for(Turn t:turns)if(t.at>along-12&&covered(along,t.at))return t;return null;}
}
