import zlib, struct, sys
def read_png(path):
    d=open(path,'rb').read(); i=8; idat=b''
    while i<len(d):
        ln=struct.unpack('>I',d[i:i+4])[0]; typ=d[i+4:i+8]; data=d[i+8:i+8+ln]; i+=12+ln
        if typ==b'IHDR':
            w,h,bd,ct,_,_,il=struct.unpack('>IIBBBBB',data); assert il==0 and bd==8
        elif typ==b'IDAT': idat+=data
        elif typ==b'IEND': break
    raw=zlib.decompress(idat); ch={0:1,2:3,3:1,4:2,6:4}[ct]; stride=w*ch
    out=bytearray(h*stride); prev=bytes(stride); p=0
    for y in range(h):
        f=raw[p]; p+=1; line=bytearray(raw[p:p+stride]); p+=stride
        if f:
            for x in range(stride):
                a=line[x-ch] if x>=ch else 0; b=prev[x]; c=prev[x-ch] if x>=ch else 0
                if f==1: line[x]=(line[x]+a)&255
                elif f==2: line[x]=(line[x]+b)&255
                elif f==3: line[x]=(line[x]+(a+b)//2)&255
                else:
                    pa=abs(b-c); pb=abs(a-c); pc=abs(a+b-2*c)
                    pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                    line[x]=(line[x]+pr)&255
        out[y*stride:(y+1)*stride]=line; prev=bytes(line)
    return w,h,ch,bytes(out)
src,dst=sys.argv[1],sys.argv[2]
thr=int(sys.argv[3]) if len(sys.argv)>3 else 128
w,h,ch,px=read_png(src)
rows=[]
for y in range(h):
    bits=[]
    for x in range(w):
        o=(y*w+x)*ch
        v = px[o+3] if ch==4 else (px[o+1] if ch==2 else 255-px[o])
        bits.append('1' if v>thr else '0')
    rows.append(''.join(bits))
open(dst,'w').write('P1\n%d %d\n'%(w,h)+'\n'.join(rows)+'\n')
print(src,w,h,'ch',ch,'->',dst)
