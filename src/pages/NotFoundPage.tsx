import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="text-6xl font-bold text-muted-foreground/50">404</div>
      <h1 className="text-2xl font-semibold mt-4">页面不存在</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        你访问的页面不存在或已被移除。回到首页继续。
      </p>
      <Button asChild className="mt-6">
        <Link to="/chat">返回对话</Link>
      </Button>
    </div>
  );
}