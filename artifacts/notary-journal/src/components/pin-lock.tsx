import { useState, useEffect } from 'react';
import { LockKeyhole, Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PinLockProps {
  onUnlock: () => void;
  expectedHash: string;
}

export function PinLock({ onUnlock, expectedHash }: PinLockProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length === 4) {
      checkPin();
    }
  }, [pin]);

  const checkPin = async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (hashHex === expectedHash) {
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => {
        setPin('');
        setError(false);
      }, 1000);
    }
  };

  const handleKeypad = (num: string) => {
    if (pin.length < 4 && !error) {
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    if (!error) {
      setPin(prev => prev.slice(0, -1));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center justify-center max-w-sm w-full p-6">
        <div className="mb-8 p-4 bg-primary/10 rounded-full">
          <LockKeyhole className="w-12 h-12 text-primary" />
        </div>
        
        <h1 className="text-2xl font-bold mb-2">Enter PIN</h1>
        <p className="text-muted-foreground text-sm mb-8 text-center">
          Unlock your notary journal
        </p>
        
        <div className="flex gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div 
              key={i} 
              className={`w-4 h-4 rounded-full border-2 transition-all ${
                i < pin.length 
                  ? 'bg-primary border-primary' 
                  : error 
                    ? 'border-destructive' 
                    : 'border-muted-foreground'
              }`} 
            />
          ))}
        </div>
        
        {error && (
          <p className="text-destructive mb-4 font-medium animate-in fade-in slide-in-from-bottom-2">
            Incorrect PIN
          </p>
        )}
        
        <div className="grid grid-cols-3 gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <Button
              key={num}
              variant="outline"
              size="lg"
              className="h-16 text-2xl font-medium rounded-2xl no-default-hover-elevate hover-elevate-2 bg-card"
              onClick={() => handleKeypad(num.toString())}
              data-testid={`button-pin-${num}`}
            >
              {num}
            </Button>
          ))}
          <div />
          <Button
            variant="outline"
            size="lg"
            className="h-16 text-2xl font-medium rounded-2xl no-default-hover-elevate hover-elevate-2 bg-card"
            onClick={() => handleKeypad('0')}
            data-testid="button-pin-0"
          >
            0
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="h-16 rounded-2xl"
            onClick={handleDelete}
            disabled={pin.length === 0}
            data-testid="button-pin-delete"
          >
            <Delete className="w-6 h-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}
