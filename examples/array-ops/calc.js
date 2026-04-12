console.log(new Array(1000000).fill(0).map((v,i)=>(1.0/(1.0+i))).reduce((acc,i)=>(acc+i)));


