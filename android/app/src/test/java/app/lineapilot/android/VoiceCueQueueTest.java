package app.lineapilot.android;
import org.junit.Test;
import static org.junit.Assert.*;
// Close cues are chained in route order, never dropped or read late (same cases as tests/main.swift).
public class VoiceCueQueueTest {
    @Test public void nearestFirstWithLiveDistanceAndChaining(){
        VoiceCueQueue q=new VoiceCueQueue();
        assertTrue(q.enqueue("stop:1",300.0,0,true,l->"Tra "+Math.round(l)+" metri, prossima fermata: Noale."));
        assertTrue(q.enqueue("turn:0",120.0,500,true,l->"Tra circa "+Math.round(l)+" metri, svolta a destra."));
        q.enqueue("turn:0",120.0,1000,true,l->"Svolta a destra.");
        assertEquals("Same manoeuvre queued twice",2,q.size());
        VoiceCueQueue.Next first=q.next(20,true,2000,1000);
        assertEquals("turn:0",first.key);
        assertEquals("Poi, svolta a destra.",first.text);
        assertNull("Positional cue read without reliable GPS",q.next(30,false,3000,2000));
        assertEquals("Tra 200 metri, prossima fermata: Noale.",q.next(100,true,4000,0).text);
        assertTrue(q.isEmpty());
    }
    @Test public void passedExpiredAndAcronyms(){
        VoiceCueQueue q=new VoiceCueQueue();
        q.enqueue("turn:5",500.0,0,false,l->"Svolta a sinistra.");
        assertNull("Passed manoeuvre read late",q.next(510,true,1000,0));
        q.enqueue("stop:9",900.0,0,false,l->"Fermata in arrivo: Treviso.");
        assertNull("Expired cue read late",q.next(800,true,40000,0));
        q.enqueue("manual",null,0,false,l->"Prossima fermata: Noale");
        assertEquals("Prossima fermata: Noale",q.next(0,false,10,0).text);
        assertEquals("Poi, SS 13 a destra.",VoiceCueQueue.chained("SS 13 a destra."));
    }
}
