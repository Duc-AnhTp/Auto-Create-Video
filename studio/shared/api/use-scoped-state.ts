import { useState,type Dispatch,type SetStateAction } from "react";
export function useScopedState<T>(initial:T,active:()=>boolean):[T,Dispatch<SetStateAction<T>>]{const [value,setValue]=useState(initial);return [value,next=>{if(active())setValue(next);}];}
