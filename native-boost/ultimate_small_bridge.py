import struct
from ultimate_bridge import UltimateClient
class SmallUltimateClient(UltimateClient):
 program_name="ultimate_small_engine"
 def __init__(self,executable,cell):
  super().__init__(executable);self.cell=cell;self.glyphs=0
 def validate(self,payload):
  if len(payload)<32:raise ValueError("Small header missing")
  magic,op,a,b,c,engine,flags,channels=struct.unpack_from("<8I",payload)
  if magic!=0x55343654:raise ValueError("Small magic invalid")
  if op==1:
   if not 170<=a<=8192 or b!=1152 or c!=self.cell or engine!=self.cell*100+1 or len(payload)!=32+a*b*4:raise ValueError("Small atlas size")
   self.glyphs=a
   return 96
  if op==2:
   if not 1<=a<=8192 or b!=self.glyphs or c!=1152 or len(payload)!=32+a*c*4:raise ValueError("Small feature size")
   return 96+a*12
  if op==3:
   if not self.glyphs or channels not in (3,4) or a<self.cell or b<self.cell or a%self.cell or b%self.cell or a*b>8640000 or not 1<=c<=145 or len(payload)!=96+c*4+a*b*channels:raise ValueError("Small pixel size")
   return 96+(a//self.cell)*(b//self.cell)*12
  raise ValueError("Small operation invalid")
