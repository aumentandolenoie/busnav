package app.lineapilot.android;

// Same metre model, acceptance thresholds and recovery as the iOS GPXTracker.
public final class GPXTracker {
    public static final class Hit { public final double along,distance; Hit(double a,double d){along=a;distance=d;} }
    public final double[][] points; public final double[] distances;
    public double along=Double.NaN;
    private double lastTime=Double.NaN,recovery=Double.NaN,recoveryTime=Double.NaN;
    public GPXTracker(double[][] input){
        if(input==null||input.length<2||input.length>20000)throw new IllegalArgumentException("GPX non valido");
        points=new double[input.length][2];distances=new double[input.length];
        for(int i=0;i<input.length;i++){
            if(input[i].length!=2||!Double.isFinite(input[i][0])||!Double.isFinite(input[i][1])||Math.abs(input[i][0])>90||Math.abs(input[i][1])>180)throw new IllegalArgumentException("Coordinate GPX non valide");
            points[i]=input[i].clone();if(i>0)distances[i]=distances[i-1]+metres(points[i-1],points[i]);
        }
        if(total()<1)throw new IllegalArgumentException("GPX senza lunghezza");
    }
    public double total(){return distances[distances.length-1];}
    public static double metres(double[] a,double[] b){
        double r=Math.PI/180,h=Math.pow(Math.sin((b[0]-a[0])*r/2),2)+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.pow(Math.sin((b[1]-a[1])*r/2),2);
        return 6371000*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
    }
    public Hit project(double[] p){return project(p,0,total());}
    private Hit project(double[] p,double start,double end){
        double best=Double.POSITIVE_INFINITY,at=0,scale=111320,lon=scale*Math.cos(p[0]*Math.PI/180);
        for(int i=0;i<points.length-1;i++){
            if(distances[i+1]<start||distances[i]>end)continue;
            double dx=(points[i+1][1]-points[i][1])*lon,dy=(points[i+1][0]-points[i][0])*scale,px=(p[1]-points[i][1])*lon,py=(p[0]-points[i][0])*scale,squared=dx*dx+dy*dy;
            double t=squared>0?Math.max(0,Math.min(1,(px*dx+py*dy)/squared)):0,a=distances[i]+t*(distances[i+1]-distances[i]);
            if(a<start||a>end)continue;double d=Math.hypot(px-t*dx,py-t*dy);if(d<best){best=d;at=a;}
        }
        return new Hit(at,best);
    }
    public Hit update(double[] p,double speed,double time,double accuracy){
        if(p==null||p.length!=2||!Double.isFinite(p[0])||!Double.isFinite(p[1])||accuracy<0||accuracy>65||!Double.isFinite(time)||(!Double.isNaN(lastTime)&&time<=lastTime))return null;
        double elapsed=Math.min(30,Math.max(.5,time-(Double.isNaN(lastTime)?time-1:lastTime)));lastTime=time;
        Hit global=project(p);if(global.distance>Math.max(45,Math.min(85,accuracy*1.5))){recovery=Double.NaN;return null;}
        if(Double.isNaN(along)){along=global.along;return global;}
        double jump=Math.max(65,Math.min(450,Math.max(5,speed)*elapsed*1.8+40));
        Hit local=project(p,Math.max(0,along-30),Math.min(total(),along+jump));double tolerance=Math.max(20,Math.min(45,accuracy));
        if(local.distance<=Math.min(65,global.distance+tolerance)){recovery=Double.NaN;along=Math.max(along,local.along);return new Hit(along,local.distance);}
        if(global.along>=along-30){
            if(!Double.isNaN(recovery)&&time-recoveryTime<15&&Math.abs(global.along-recovery)<=Math.max(80,Math.max(5,speed)*elapsed*2+30)){along=Math.max(along,global.along);recovery=Double.NaN;return new Hit(along,global.distance);}
            recovery=global.along;recoveryTime=time;
        }
        return null;
    }
    public double[] coordinate(double value){double at=Math.min(total(),Math.max(0,value));int i=1;while(i<distances.length-1&&distances[i]<at)i++;double t=(at-distances[i-1])/Math.max(.001,distances[i]-distances[i-1]);return new double[]{points[i-1][0]+t*(points[i][0]-points[i-1][0]),points[i-1][1]+t*(points[i][1]-points[i-1][1])};}
}
