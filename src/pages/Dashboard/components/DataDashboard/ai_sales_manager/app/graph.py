"""Assemble the LangGraph pipeline: plan → discover → analyze → deliver."""
from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .nodes import plan_node, discover_node, analyze_node, deliver_node


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("plan", plan_node)
    g.add_node("discover", discover_node)
    g.add_node("analyze", analyze_node)
    g.add_node("deliver", deliver_node)

    g.add_edge(START, "plan")
    g.add_edge("plan", "discover")
    g.add_edge("discover", "analyze")
    g.add_edge("analyze", "deliver")
    g.add_edge("deliver", END)
    return g.compile()


GRAPH = build_graph()
