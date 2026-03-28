export const LoadingScreen = ({ progress }: { progress: number }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-black text-white z-50">
    <div className="w-64">
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div 
          className="h-full bg-blue-500 transition-all duration-300" 
          style={{ width: `${progress}%` }} 
        />
      </div>
      <p className="mt-2 text-center text-sm">Loading game assets... {progress}%</p>
    </div>
  </div>
);
