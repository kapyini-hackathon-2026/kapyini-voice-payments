import { createContext, useContext } from 'react';

export const KapyiniContext = createContext(null);
export const useKapyini = () => useContext(KapyiniContext);
