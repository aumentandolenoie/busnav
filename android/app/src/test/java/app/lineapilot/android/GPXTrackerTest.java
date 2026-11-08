package app.lineapilot.android;
import org.junit.Test;
import static org.junit.Assert.*;
public class GPXTrackerTest {
    @Test(expected=IllegalArgumentException.class) public void emptyRejected(){new GPXTracker(new double[0][2]);}
    @Test(expected=IllegalArgumentException.class) public void invalidRejected(){new GPXTracker(new double[][]{{45,11},{Double.NaN,11}});}
    @Test(expected=IllegalArgumentException.class) public void zeroRejected(){new GPXTracker(new double[][]{{45,11},{45,11}});}
    @Test public void progressionAndRecoveryMatchIos(){GPXTracker t=new GPXTracker(new double[][]{{45,11},{45,11.01},{45.01,11.01}});
        assertTrue(t.update(new double[]{45,11.001},10,100,5).along>50);
        assertNull(t.update(new double[]{45,11.002},10,99,5));assertNull(t.update(new double[]{45,11.002},10,101,100));
        assertNull(t.update(new double[]{46,12},10,102,5));assertNull(t.update(new double[]{45.005,11.01},10,103,5));assertNotNull(t.update(new double[]{45.0051,11.01},10,104,5));
        assertEquals(45.01,t.coordinate(1000000)[0],.00001);
    }
    @Test public void crossingNeverSkipsLap(){GPXTracker t=new GPXTracker(new double[][]{{45,11},{45,11.01},{45.01,11.01},{45.01,11},{45,11},{45,10.99}});t.update(new double[]{45,11.0001},6,10,5);assertTrue(t.update(new double[]{45,11},6,11,5).along<100);}
    @Test public void coverageCannotAnnounceAcrossGap(){double[][] r={{0,100},{150,200}};assertTrue(GuidanceCoverage.contains(r,80,90));assertFalse(GuidanceCoverage.contains(r,80,175));assertFalse(GuidanceCoverage.contains(r,125,175));assertTrue(GuidanceCoverage.contains(r,175,190));assertFalse(GuidanceCoverage.contains(new double[0][2],0,0));}
    @Test public void sourceCoordinatesAreNotMutated(){double[][] p={{45,11},{45,11.01}};GPXTracker t=new GPXTracker(p);t.update(new double[]{45,11.005},10,1,5);assertArrayEquals(new double[]{45,11},p[0],0);}
}
