package app.lineapilot.android;
import android.Manifest;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import java.util.*;

final class NavigationSession implements LocationListener {
    final MainActivity owner;final NativeRoute route;final GPXTracker tracker;final DriverView screen;
    final boolean demo;private double demoProgress;boolean active=true,voice,turnVoice,matched;int stopIndex;double along;
    private double chainedStopAfter = Double.NEGATIVE_INFINITY;
    private long lastGood,lastOffRoute;private final Map<Integer,Integer> stopStages=new HashMap<>(),turnStages=new HashMap<>();
    private final LocationManager locations;private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable watchdog=new Runnable(){public void run(){if(!active)return;if(SystemClock.elapsedRealtime()-lastGood>8000){matched=false;owner.stopNativeSpeech();screen.progress(along,stopIndex,false,0);screen.message("Segnale GPS non aggiornato · annunci sospesi");}handler.postDelayed(this,2000);}};
    NavigationSession(MainActivity owner,NativeRoute route,boolean voice,boolean turns,boolean demo){this.demo=demo;this.owner=owner;this.route=route;this.voice=voice;turnVoice=turns;tracker=new GPXTracker(route.points);locations=(LocationManager)owner.getSystemService(android.content.Context.LOCATION_SERVICE);screen=new DriverView(owner,this,owner.layoutTest);lastGood=SystemClock.elapsedRealtime();}
    private final Runnable demoTick=new Runnable(){public void run(){if(!active)return;double[] point=tracker.coordinate(demoProgress);Location p=new Location("simulation");p.setLatitude(point[0]);p.setLongitude(point[1]);p.setAccuracy(5);p.setSpeed(14);p.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());p.setTime(System.currentTimeMillis());onLocationChanged(p);screen.message("SIMULAZIONE · posizione virtuale");demoProgress+=14;if(demoProgress>tracker.total()+50){pause();screen.message("Simulazione completata");return;}handler.postDelayed(this,1000);}};
    void resume(){if(!active)return;matched=false;lastGood=SystemClock.elapsedRealtime();handler.removeCallbacks(watchdog);if(demo){handler.removeCallbacks(demoTick);handler.post(demoTick);return;}if(owner.layoutTest)return;
        boolean fine=owner.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,coarse=owner.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
        if(!fine&&!coarse){owner.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},43);return;}
        handler.postDelayed(watchdog,2000);
        try{
            locations.removeUpdates(this);boolean enabled=false;
            if(fine&&locations.isProviderEnabled(LocationManager.GPS_PROVIDER)){locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,1000,0,this);enabled=true;}
            if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)){locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,1000,0,this);enabled=true;}
            screen.message(!fine?"Attiva Posizione precisa nelle impostazioni Android":enabled?"Ricerca GPS · GPX ufficiale":"Attiva la posizione di Android");
        }catch(SecurityException|IllegalArgumentException e){screen.message("GPS non disponibile: "+e.getMessage());}
    }
    void pause(){handler.removeCallbacks(demoTick);handler.removeCallbacks(watchdog);locations.removeUpdates(this);matched=false;owner.stopNativeSpeech();}
    void stop(){active=false;pause();}
    @Override public void onLocationChanged(Location p){
        if(!active)return;long age=(SystemClock.elapsedRealtimeNanos()-p.getElapsedRealtimeNanos())/1000000;
        if(!p.hasAccuracy()||p.getAccuracy()>65||p.getAccuracy()<0||age>8000||age< -2000){matched=false;owner.stopNativeSpeech();screen.progress(along,stopIndex,false,0);screen.message("GPS poco preciso · annunci sospesi");return;}
        lastGood=SystemClock.elapsedRealtime();double speed=p.hasSpeed()?Math.max(0,p.getSpeed()):0;double[] point={p.getLatitude(),p.getLongitude()};GPXTracker.Hit hit=tracker.update(point,speed,p.getElapsedRealtimeNanos()/1e9,p.getAccuracy());
        if(hit==null){matched=false;double distance=tracker.project(point).distance;screen.location(p,false,along);screen.progress(along,stopIndex,false,distance);screen.message(distance>85?"Fuori percorso · segui il GPX ufficiale":"GPS in riallineamento · annunci sospesi");owner.stopNativeSpeech();if(distance>85&&SystemClock.elapsedRealtime()-lastOffRoute>45000){if(voice)owner.speakNavigation("Sei fuori dal percorso ufficiale. Controlla la posizione sul GPX.",true);lastOffRoute=SystemClock.elapsedRealtime();}return;}
        matched=true;along=hit.along;while(stopIndex<route.stops.length&&along>route.offsets[stopIndex]+35)stopIndex++;
        if(stopIndex==0&&route.offsets.length>1&&route.offsets[0]<50&&Math.abs(along-route.offsets[0])<30)stopIndex=1;
        screen.location(p,true,along);screen.progress(along,stopIndex,true,hit.distance);screen.message("GPS ±"+Math.round(p.getAccuracy())+" m · GPX ufficiale");
        announce(speed, hit.distance);
    }

    private int nextVoiceTurn(double maxDistance) {
        for (int i = 0; i < route.turns.size(); i++) {
            NativeRoute.Turn turn = route.turns.get(i);
            if (turn.at >= along + maxDistance) break;
            if (turn.at <= along - 12 || !route.covered(along, turn.at)) continue;
            if (turn.at <= along && turnStages.getOrDefault(i, 0) == 2) continue;
            return i;
        }
        return -1;
    }

    private void announce(double speed, double deviation) {
        if (!voice) return;
        int index = turnVoice && deviation < 65 ? nextVoiceTurn(450) : -1;
        NativeRoute.Turn turn = index < 0 ? null : route.turns.get(index);
        double distance = turn == null ? Double.POSITIVE_INFINITY : turn.at - along;
        double lead = Math.max(150, Math.min(350, Math.max(speed, 6) * 18));
        double near = Math.max(20, speed * 3);
        double stopLead = Math.max(140, Math.min(400, Math.max(speed, 6) * 22));
        double remaining = stopIndex < route.stops.length ? route.offsets[stopIndex] - along : Double.POSITIVE_INFINITY;
        int stopStage = stopStages.getOrDefault(stopIndex, 0);

        boolean stopFollowsChain = false;
        if (turn != null && distance >= 0 && turnStages.getOrDefault(index, 0) == 0) {
            NativeRoute.Continuation continuation = route.continuation(index, along, stopIndex);
            if (continuation != null) {
                Map<Integer, Integer> stages = continuation.isStop ? stopStages : turnStages;
                if (stages.getOrDefault(continuation.index, 0) == 0) {
                    stopFollowsChain = continuation.isStop;
                    double chainLead = continuation.isStop ? Math.max(lead, stopLead - (route.offsets[continuation.index] - turn.at)) : lead;
                    if (distance <= chainLead && owner.speakNavigation(
                            NativeRoute.voiceMessage(turn.text, distance > near ? distance : null, continuation),
                            continuation.isStop)) {
                        turnStages.put(index, distance <= near ? 2 : 1);
                        stages.put(continuation.index, 1);
                        if (continuation.isStop) chainedStopAfter = turn.at;
                        return;
                    }
                }
            }
        }

        if (stopIndex < route.stops.length && deviation < 100 && remaining >= 0) {
            if (stopStage == 0 && remaining <= stopLead && !stopFollowsChain && !owner.navigationSpeaking()) {
                if (owner.speakNavigation("Tra " + Math.max(50, Math.round(remaining / 50) * 50)
                        + " metri, prossima fermata: " + route.stops[stopIndex] + ".", true)) {
                    stopStages.put(stopIndex, 1);
                    return;
                }
            } else if (stopStage == 1 && remaining <= 65 && remaining >= 8 && speed > 2 && along >= chainedStopAfter) {
                if (owner.speakNavigation("Fermata in arrivo: " + route.stops[stopIndex] + ".", true)) {
                    stopStages.put(stopIndex, 2);
                    return;
                }
            }
        }
        if (turn == null) return;
        int stage = turnStages.getOrDefault(index, 0);
        if (stage < 2 && distance <= near) {
            if (owner.speakNavigation(NativeRoute.voiceMessage(turn.text, null, null), false)) turnStages.put(index, 2);
        } else if (stage == 0 && distance <= lead) {
            if (owner.speakNavigation(NativeRoute.voiceMessage(turn.text, distance, null), false)) turnStages.put(index, 1);
        }
    }

    void repeat() {
        if (!voice || !matched) return;
        int index = turnVoice ? nextVoiceTurn(Double.POSITIVE_INFINITY) : -1;
        int stop = route.upcomingStop(along, stopIndex);
        double stopAt = stop < route.stops.length ? route.offsets[stop] : Double.POSITIVE_INFINITY;
        if (index >= 0 && route.turns.get(index).at < stopAt) {
            NativeRoute.Turn turn = route.turns.get(index);
            double distance = turn.at - along;
            owner.speakNavigation(NativeRoute.voiceMessage(turn.text, distance > 20 ? distance : null,
                    route.continuation(index, along, stopIndex)), true);
        } else if (stop < route.stops.length) {
            owner.speakNavigation("Prossima fermata: " + route.stops[stop], true);
        } else {
            owner.speakNavigation("Segui il percorso ufficiale.", true);
        }
    }
    @Override public void onProviderDisabled(String provider){matched=false;owner.stopNativeSpeech();screen.message("Segnale GPS non disponibile");}
    @Override public void onProviderEnabled(String provider){}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
}

