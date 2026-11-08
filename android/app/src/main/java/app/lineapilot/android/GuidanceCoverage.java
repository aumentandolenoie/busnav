package app.lineapilot.android;
public final class GuidanceCoverage {
    public static boolean contains(double[][] ranges,double progress,double maneuver){
        for(double[] r:ranges)if(r.length==2&&Double.isFinite(r[0])&&Double.isFinite(r[1])&&r[0]<=progress&&progress<=r[1]&&r[0]<=maneuver&&maneuver<=r[1])return true;
        return false;
    }
}
