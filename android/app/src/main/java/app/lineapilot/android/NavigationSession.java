package app.lineapilot.android;
import android.Manifest;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import java.util.*;

final class NavigationSession implements LocationListener {
    final MainActivity owner;final NativeRoute route;final GPXTracker tracker;final DriverView screen;
    final boolean demo;private double demoProgress;boolean active=true,voice,turnVoice,matched;int stopIndex;double along;
    private final Set<Integer> spokenCameras = new HashSet<>();
    private double chainedStopAfter = Double.NEGATIVE_INFINITY;
    private long lastGood,lastOffRoute;private final Map<Integer,Integer> stopStages=new HashMap<>(),turnStages=new HashMap<>();
    private final LocationManager locations;private final Handler handler=new Handler(Looper.getMainLooper());
    // Spoken guidance: one cue at a time, the others wait in `cues` (see VoiceCueQueue).
    private final VoiceCueQueue cues=new VoiceCueQueue();
    private String currentId,currentKey,currentText="";private boolean currentStarted;private int startAttempts;
    private long lastSpeechEnd=Long.MIN_VALUE/2,lastStopRequest=Long.MIN_VALUE/2;
    private final Runnable speechWatchdog=this::recoverStuckSpeech;
    private final Runnable pumpLater=this::pumpVoice;
    private final Runnable watchdog=new Runnable(){public void run(){if(!active)return;if(SystemClock.elapsedRealtime()-lastGood>8000){matched=false;flushVoice();screen.progress(along,stopIndex,false,0);screen.message("Segnale GPS non aggiornato · annunci sospesi");}handler.postDelayed(this,2000);}};
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
    void pause(){handler.removeCallbacks(demoTick);handler.removeCallbacks(watchdog);locations.removeUpdates(this);matched=false;flushVoice();}
    void stop(){active=false;pause();}
    @Override public void onLocationChanged(Location p){
        if(!active)return;long age=(SystemClock.elapsedRealtimeNanos()-p.getElapsedRealtimeNanos())/1000000;
        if(!p.hasAccuracy()||p.getAccuracy()>65||p.getAccuracy()<0||age>8000||age< -2000){matched=false;/* positional cues wait; the current sentence is not cut */screen.progress(along,stopIndex,false,0);screen.message("GPS poco preciso · annunci sospesi");return;}
        lastGood=SystemClock.elapsedRealtime();double speed=p.hasSpeed()?Math.max(0,p.getSpeed()):0;double[] point={p.getLatitude(),p.getLongitude()};GPXTracker.Hit hit=tracker.update(point,speed,p.getElapsedRealtimeNanos()/1e9,p.getAccuracy());
        if(hit==null){matched=false;double distance=tracker.project(point).distance;screen.location(p,false,along);screen.progress(along,stopIndex,false,distance);screen.message(distance>85?"Fuori percorso · segui il GPX ufficiale":"GPS in riallineamento · annunci sospesi");if(distance>85&&SystemClock.elapsedRealtime()-lastOffRoute>45000){if(voice){cues.clear();enqueueCue("offroute",null,left->"Sei fuori dal percorso ufficiale. Controlla la posizione sul GPX.");}lastOffRoute=SystemClock.elapsedRealtime();}return;}
        matched=true;along=hit.along;while(stopIndex<route.stops.length&&along>route.offsets[stopIndex]+35)stopIndex++;
        if(stopIndex==0&&route.offsets.length>1&&route.offsets[0]<50&&Math.abs(along-route.offsets[0])<30)stopIndex=1;
        screen.location(p,true,along);screen.progress(along,stopIndex,true,hit.distance);screen.message("GPS ±"+Math.round(p.getAccuracy())+" m · GPX ufficiale");
        announce(speed, hit.distance);
        if (voice && hit.distance < 45) {
            int index = route.nextCamera(along, Math.max(120, Math.min(250, speed * 12)), spokenCameras);
            if (index >= 0) {
                NativeRoute.Camera camera = route.cameras.get(index);
                String title = camera.title.toLowerCase(Locale.ITALIAN);
                if (camera.at - along >= 15 && enqueueCue("camera:" + index, camera.at, left ->
                        left == null || left < 15 ? null : "Tra circa " + DistanceText.spoken(left) + ", " + title + ".")) {
                    spokenCameras.add(index);
                }
            }
        }
        // Cues held during a GPS dropout resume as soon as the position is reliable.
        pumpVoice();
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

    private static Double spokenDistance(Double left, double near) {
        return left != null && left > near ? left : null;
    }

    // Cues are queued, never dropped because something else is being said: the
    // stop or manoeuvre that comes first along the GPX is read first, the next one
    // follows ("Poi, ..."). Distances are recomputed when each cue is actually read.
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
                    String text = turn.text;
                    if (distance <= chainLead && enqueueCue("turn:" + index, turn.at,
                            left -> NativeRoute.voiceMessage(text, spokenDistance(left, near), continuation))) {
                        turnStages.put(index, distance <= near ? 2 : 1);
                        stages.put(continuation.index, 1);
                        if (continuation.isStop) chainedStopAfter = turn.at;
                        return;
                    }
                }
            }
        }

        if (stopIndex < route.stops.length && deviation < 100 && remaining >= 0) {
            String name = route.stops[stopIndex];
            String key = "stop:" + stopIndex;
            double target = route.offsets[stopIndex];
            if (stopStage == 0 && remaining <= stopLead && !stopFollowsChain) {
                if (enqueueCue(key, target, left -> left != null && left < 40 ? "Fermata in arrivo: " + name + "."
                        : "Tra " + DistanceText.spoken(left == null ? remaining : left) + ", prossima fermata: " + name + ".")) {
                    stopStages.put(stopIndex, 1);
                }
            } else if (stopStage == 1 && remaining <= 65 && remaining >= 8 && speed > 2 && along >= chainedStopAfter) {
                if (enqueueCue(key, target, left -> "Fermata in arrivo: " + name + ".")) {
                    stopStages.put(stopIndex, 2);
                }
            }
        }
        if (turn == null) return;
        int stage = turnStages.getOrDefault(index, 0);
        String text = turn.text;
        if (stage < 2 && distance <= near) {
            if (enqueueCue("turn:" + index, turn.at, left -> NativeRoute.voiceMessage(text, null, null))) {
                turnStages.put(index, 2);
            }
        } else if (stage == 0 && distance <= lead) {
            if (enqueueCue("turn:" + index, turn.at, left -> NativeRoute.voiceMessage(text, spokenDistance(left, near), null))) {
                turnStages.put(index, 1);
            }
        }
    }

    /** Top-panel button: also rebuilds the voice state, so it always works as a manual recovery. */
    void repeat() {
        if (!voice || !matched) return;
        int index = turnVoice ? nextVoiceTurn(Double.POSITIVE_INFINITY) : -1;
        int stop = route.upcomingStop(along, stopIndex);
        double stopAt = stop < route.stops.length ? route.offsets[stop] : Double.POSITIVE_INFINITY;
        if (index >= 0 && route.turns.get(index).at < stopAt) {
            NativeRoute.Turn turn = route.turns.get(index);
            double distance = turn.at - along;
            speakNow(NativeRoute.voiceMessage(turn.text, distance > 20 ? distance : null,
                    route.continuation(index, along, stopIndex)));
        } else if (stop < route.stops.length) {
            speakNow("Prossima fermata: " + route.stops[stop]);
        } else {
            speakNow("Segui il percorso ufficiale.");
        }
    }

    // ---- Speech queue -------------------------------------------------------

    /** Queues a cue; true when it is being read or waiting. The same stop/manoeuvre is never duplicated. */
    private boolean enqueueCue(String key, Double target, VoiceCueQueue.Maker make) {
        if (!voice) return false;
        if (currentId != null && key.equals(currentKey)) return true;
        cues.discardStale(along, matched, SystemClock.elapsedRealtime());
        boolean kept = cues.enqueue(key, target, SystemClock.elapsedRealtime(), currentId != null, make);
        pumpVoice();
        return kept;
    }

    /** Manual requests (repeat, test voice) replace whatever is queued and are read immediately. */
    void speakNow(String text) {
        flushVoice();
        cues.enqueue("manual", null, SystemClock.elapsedRealtime(), false, left -> text);
        pumpVoice();
    }

    private void pumpVoice() {
        if (currentId != null) return;
        if (cues.isEmpty()) { owner.releaseNavigationAudio(); return; }
        long sinceStop = SystemClock.elapsedRealtime() - lastStopRequest;
        if (sinceStop < 250) { handler.removeCallbacks(pumpLater); handler.postDelayed(pumpLater, 250 - sinceStop); return; }
        VoiceCueQueue.Next next = cues.next(along, matched, SystemClock.elapsedRealtime(), lastSpeechEnd);
        if (next == null) { owner.releaseNavigationAudio(); return; }
        startAttempts = 0;
        startUtterance(next.text, next.key);
    }

    private void startUtterance(String text, String key) {
        String id = owner.startNavigationUtterance(text);
        if (id == null) return; // TTS not ready or audio focus refused: dropped, never read late
        currentId = id; currentKey = key; currentText = text; currentStarted = false;
        armSpeechWatchdog(5000);
    }

    private void armSpeechWatchdog(long ms) {
        handler.removeCallbacks(speechWatchdog);
        handler.postDelayed(speechWatchdog, ms);
    }

    void onSpeechStarted(String id) {
        if (!id.equals(currentId)) return;
        currentStarted = true;
        // Generous upper bound for the whole sentence; normal cues end well before.
        armSpeechWatchdog((long) (currentText.length() * 110 / Math.max(.5, owner.speechRate())) + 5000);
    }

    void onSpeechEnded(String id, boolean ok) {
        // Late callbacks from an utterance that was already replaced are ignored.
        if (!id.equals(currentId)) return;
        handler.removeCallbacks(speechWatchdog);
        boolean heard = ok && currentStarted;
        clearCurrent();
        if (heard) lastSpeechEnd = SystemClock.elapsedRealtime();
        pumpVoice();
    }

    /**
     * The TTS engine sometimes never reports the start or the end of an utterance.
     * The app then thought it was still speaking and stayed silent until the repeat
     * button was pressed. Now the cue is abandoned (retried once if it never started)
     * and the queue carries on by itself.
     */
    private void recoverStuckSpeech() {
        if (currentId == null) return;
        String text = currentText, key = currentKey;
        boolean heard = currentStarted, retry = !heard && startAttempts == 0;
        clearCurrent();
        owner.cancelNavigationUtterance();
        lastStopRequest = SystemClock.elapsedRealtime();
        if (heard) lastSpeechEnd = lastStopRequest;
        if (retry) {
            startAttempts = 1;
            handler.postDelayed(() -> { if (currentId == null && active) startUtterance(text, key); }, 250);
        } else {
            pumpVoice();
        }
    }

    private void clearCurrent() { currentId = null; currentKey = null; currentText = ""; currentStarted = false; }

    /** Silences guidance now and forgets queued cues (GPS lost, voice off, end of trip). */
    void flushVoice() {
        cues.clear();
        handler.removeCallbacks(speechWatchdog);
        handler.removeCallbacks(pumpLater);
        boolean wasSpeaking = currentId != null || owner.navigationSpeaking();
        clearCurrent();
        if (wasSpeaking) { owner.cancelNavigationUtterance(); lastStopRequest = SystemClock.elapsedRealtime(); }
        owner.releaseNavigationAudio();
    }
    @Override public void onProviderDisabled(String provider){matched=false;flushVoice();screen.message("Segnale GPS non disponibile");}
    @Override public void onProviderEnabled(String provider){}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
}
